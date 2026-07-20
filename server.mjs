// mint room — zero-dependency local server.
// Serves the static frontend and provides the server-side OpenAI boundary.
// The API key never reaches the client.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { MODELS, DEFAULT_MODEL, createChatResponse, createDiaryEntry, classifyNews } from "./server/openai.mjs";
import { getNews, keywordClassify, classificationCache } from "./server/news.mjs";

const PORT = Number(process.env.PORT) || 3000;
// fileURLToPath keeps this working on Windows too (URL.pathname would not).
const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));

// Stable, privacy-preserving safety identifier for this server instance.
// Deliberately NOT derived from email/name/any personal data.
const SAFETY_IDENTIFIER = `mint-room-${randomUUID()}`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/api/status" && req.method === "GET") {
      return sendJSON(res, 200, {
        hasApiKey: Boolean(process.env.OPENAI_API_KEY),
        models: MODELS,
        defaultModel: DEFAULT_MODEL,
      });
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      const body = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return sendJSON(res, 400, { ok: false, error: "Invalid JSON body." });
      }
      const { settings = {}, messages } = parsed ?? {};
      if (!Array.isArray(messages) || messages.length === 0) {
        return sendJSON(res, 400, { ok: false, error: "messages must be a non-empty array." });
      }
      const result = await createChatResponse(settings, messages, SAFETY_IDENTIFIER);
      return sendJSON(res, result.ok ? 200 : 502, result);
    }

    if (url.pathname === "/api/diary" && req.method === "POST") {
      const body = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return sendJSON(res, 400, { ok: false, error: "Invalid JSON body." });
      }
      const { settings = {}, snapshot } = parsed ?? {};
      if (!snapshot || typeof snapshot.date !== "string") {
        return sendJSON(res, 400, { ok: false, error: "snapshot with a date is required." });
      }
      const result = await createDiaryEntry(settings, snapshot, SAFETY_IDENTIFIER);
      return sendJSON(res, result.ok ? 200 : 502, result);
    }

    if (url.pathname === "/api/news" && req.method === "POST") {
      // やさしいニュース(docs/gentle-news-design.md)。
      // RSS取得→LLM分類(キーがあれば)→無ければキーワード簡易モード。
      const body = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return sendJSON(res, 400, { ok: false, error: "Invalid JSON body." });
      }
      const { settings = {}, prefs = {}, force = false } = parsed ?? {};
      const feedResult = await getNews(Boolean(force));
      // 未分類の記事だけをLLMに渡す(分類キャッシュでコスト管理)
      const unclassified = feedResult.items.filter((it) => !classificationCache.has(it.id));
      const llm = await classifyNews(settings, unclassified, prefs, SAFETY_IDENTIFIER);
      if (llm.ok && llm.classifications) {
        for (const [id, c] of llm.classifications) classificationCache.set(id, c);
      }
      let items;
      let classifiedBy;
      if (llm.ok || (unclassified.length === 0 && feedResult.items.some((it) => classificationCache.has(it.id)))) {
        classifiedBy = "llm";
        items = feedResult.items
          .map((it) => ({ ...it, ...(classificationCache.get(it.id) ?? { lane: "general", distress: "unrated", confidence: "unrated", gentle_summary: null, ai_comment: null, matched_topics: [] }) }))
          .filter((it) => it.lane !== "drop");
      } else {
        // キー無し・分類失敗時の正直なフォールバック(UIに簡易モードと表示される)
        classifiedBy = "keyword";
        items = keywordClassify(feedResult.items, prefs);
      }
      return sendJSON(res, 200, {
        ok: true,
        classifiedBy,
        fetchedAt: feedResult.fetchedAt,
        fromCache: feedResult.fromCache,
        feedErrors: feedResult.errors,
        items,
      });
    }

    // Static files
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    try {
      path = decodeURIComponent(path); // allow non-ASCII filenames
    } catch {
      return sendJSON(res, 400, { error: "Bad path" });
    }
    const filePath = resolve(join(PUBLIC_DIR, path));
    // resolve() collapses any ../ segments; reject anything outside public/.
    if (!filePath.startsWith(resolve(PUBLIC_DIR) + sep)) {
      return sendJSON(res, 403, { error: "Forbidden" });
    }
    try {
      const data = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(data);
    } catch {
      sendJSON(res, 404, { error: "Not found" });
    }
  } catch (err) {
    const status = err?.message === "Body too large" ? 413 : 500;
    if (!res.headersSent) sendJSON(res, status, { ok: false, error: status === 413 ? "Request body too large." : "Server error." });
    else res.end();
    console.error(err);
  }
});

function sendJSON(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > limit) {
        // Discard the rest instead of destroying the socket, so the
        // 413 response can actually reach the client.
        req.removeAllListeners("data");
        req.resume();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

server.listen(PORT, () => {
  console.log(`mint room 🌿 http://localhost:${PORT}`);
  console.log(process.env.OPENAI_API_KEY ? "OpenAI key: configured" : "OpenAI key: NOT set — running in mock mode");
});
