// mint room — zero-dependency local server.
// Serves the static frontend and provides the server-side OpenAI boundary.
// The API key never reaches the client.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { MODELS, DEFAULT_MODEL, createChatResponse, createDiaryEntry, classifyNews } from "./server/openai.mjs";
import { getNews, keywordClassify, prefsCacheKey, getCachedClassification, setCachedClassification } from "./server/news.mjs";
import { isJSONContentType, isTrustedPaidProviderRequest } from "./server/access.mjs";

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
// fileURLToPath keeps this working on Windows too (URL.pathname would not).
const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));

// Stable, privacy-preserving safety identifier for this server instance.
// Deliberately NOT derived from email/name/any personal data.
const SAFETY_IDENTIFIER = `mint-room-${randomUUID()}`;
const PAID_PROVIDER_PATHS = new Set(["/api/chat", "/api/diary", "/api/news"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    // JSON必須化により、外部サイトがpreflightなしで送れる単純POSTを先に拒否する。
    if (
      req.method === "POST" &&
      PAID_PROVIDER_PATHS.has(url.pathname) &&
      !isJSONContentType(req.headers["content-type"])
    ) {
      return sendJSON(res, 415, { ok: false, error: "Content-Type must be application/json." });
    }

    // 公開用の認証・レート制限がないため、APIキー利用時は同じ端末・同じOriginに限定する。
    if (
      req.method === "POST" &&
      PAID_PROVIDER_PATHS.has(url.pathname) &&
      process.env.OPENAI_API_KEY &&
      !isTrustedPaidProviderRequest({
        remoteAddress: req.socket.remoteAddress,
        hostHeader: req.headers.host,
        originHeader: req.headers.origin,
        contentType: req.headers["content-type"],
        secFetchSite: req.headers["sec-fetch-site"],
      })
    ) {
      return sendJSON(res, 403, {
        ok: false,
        error: "Paid provider access is limited to localhost. Use mock mode for remote access.",
      });
    }

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
      // 分類キャッシュは「記事ID×興味リスト」単位。興味を変えると再分類される
      const prefsKey = prefsCacheKey(prefs);
      const unclassified = feedResult.items.filter((it) => !getCachedClassification(it.id, prefsKey));
      // 一括分類は40件まで(出力トークン上限内に収める。残りは次回更新時に分類され、
      // それまでは general レーンで表示される)
      const batch = unclassified.slice(0, 40);
      const llm = await classifyNews(settings, batch, prefs, SAFETY_IDENTIFIER);
      if (llm.ok && llm.classifications) {
        for (const [id, c] of llm.classifications) setCachedClassification(id, prefsKey, c);
      }
      let items;
      let classifiedBy;
      const anyClassified = feedResult.items.some((it) => getCachedClassification(it.id, prefsKey));
      if (llm.ok || anyClassified) {
        classifiedBy = "llm";
        items = feedResult.items
          .map((it) => ({ ...it, ...(getCachedClassification(it.id, prefsKey) ?? { lane: "general", distress: "unrated", confidence: "unrated", gentle_summary: null, ai_comment: null, matched_topics: [] }) }))
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

server.listen(PORT, HOST, () => {
  console.log(`mint room 🌿 http://${HOST}:${PORT}`);
  console.log(process.env.OPENAI_API_KEY ? "OpenAI key: configured" : "OpenAI key: NOT set — running in mock mode");
});
