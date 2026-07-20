// mint room — zero-dependency local server.
// Serves the static frontend and provides the server-side OpenAI boundary.
// The API key never reaches the client.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { MODELS, DEFAULT_MODEL, createChatResponse } from "./server/openai.mjs";

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = new URL("./public/", import.meta.url).pathname;

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

    // Static files
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    path = normalize(path).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(PUBLIC_DIR, path);
    if (!filePath.startsWith(PUBLIC_DIR)) return sendJSON(res, 403, { error: "Forbidden" });
    try {
      const data = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(data);
    } catch {
      sendJSON(res, 404, { error: "Not found" });
    }
  } catch (err) {
    sendJSON(res, 500, { ok: false, error: "Server error." });
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
        reject(new Error("Body too large"));
        req.destroy();
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
