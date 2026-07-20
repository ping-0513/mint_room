// やさしいニュース — RSS取得・パース・キャッシュ・簡易フィルタ。
// 設計: docs/gentle-news-design.md
// 役割分担: 収集と一次選別は報道機関のRSSに任せ、このモジュールは
// 「取得と整形」だけを担当する。レーン分け・つらさ判定・確度ラベルは
// LLM分類(server/openai.mjs の classifyNews)が主役で、APIキーが無い時は
// このファイルのキーワード簡易フィルタが安全網として代役を務める。

import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

// 既定フィード。編集しやすいようここに集約(モデルリストと同じ思想)。
// URLが死んでもタブ全体は壊れない(フィード単位で失敗を握りつぶす)。
export const DEFAULT_FEEDS = [
  { url: "https://www3.nhk.or.jp/rss/news/cat0.xml", source: "NHK主要", lane_hint: "essential" },
  { url: "https://rss.itmedia.co.jp/rss/2.0/aiplus.xml", source: "ITmedia AI+", lane_hint: "interest" },
  { url: "https://natalie.mu/comic/feed/news", source: "コミックナタリー", lane_hint: "interest" },
  { url: "https://www.reddit.com/r/LocalLLaMA/.rss", source: "Reddit r/LocalLLaMA", lane_hint: "rumor" },
];

const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30分。ニュースの鮮度と回線・相手先への礼儀のバランス
const MAX_ITEMS = 60;

// 暴力事件などの一次ブロック語。LLM分類が使えない時の安全網なので、
// 過剰ブロック(例:「死亡」は災害情報も消してしまう)を避けた最小リスト。
export const FALLBACK_BLOCK_WORDS = ["殺人", "殺害", "遺体", "刺さ", "絞殺", "撲殺", "虐待", "自殺"];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

let cache = { fetchedAt: 0, items: [] };

const toArray = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const textOf = (x) => (typeof x === "object" && x !== null ? String(x["#text"] ?? "") : String(x ?? ""));
const stripTags = (s) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** RSS2.0 / Atom 両対応のパース。壊れたXMLは空配列(純関数・テスト対象)。 */
export function parseFeed(xml, sourceName) {
  try {
    const doc = parser.parse(xml);
    let raw = [];
    if (doc?.rss?.channel) {
      raw = toArray(doc.rss.channel.item).map((it) => ({
        title: textOf(it.title),
        link: textOf(it.link),
        summary: stripTags(textOf(it.description)),
        pubDate: Date.parse(textOf(it.pubDate)) || 0,
      }));
    } else if (doc?.feed) {
      raw = toArray(doc.feed.entry).map((it) => {
        // Atom の link は属性 href。複数ある場合は最初の alternate を優先
        const links = toArray(it.link);
        const alt = links.find((l) => (l?.["@_rel"] ?? "alternate") === "alternate") ?? links[0];
        return {
          title: textOf(it.title),
          link: String(alt?.["@_href"] ?? ""),
          summary: stripTags(textOf(it.summary ?? it.content)),
          pubDate: Date.parse(textOf(it.updated ?? it.published)) || 0,
        };
      });
    }
    return raw
      .filter((it) => it.title && it.link)
      .map((it) => ({
        // IDはURLのハッシュ: 再取得しても同一記事を同一IDにして分類キャッシュを効かせる
        id: createHash("sha1").update(it.link).digest("hex").slice(0, 12),
        source: sourceName,
        ...it,
        summary: it.summary.slice(0, 300),
      }));
  } catch {
    return [];
  }
}

async function fetchOneFeed(feed) {
  const res = await fetch(feed.url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "mint-room/0.1 (personal assistant app)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text(), feed.source);
}

/**
 * 全フィードを取得してマージ(TTLキャッシュつき)。
 * フィード単位の失敗は errors に記録するだけで全体は成功させる —
 * 「壊れたRSSでもタブ全体は壊れない」(設計 §7)のための構造。
 */
export async function getNews(force = false, feeds = DEFAULT_FEEDS) {
  const now = Date.now();
  if (!force && cache.items.length && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { items: cache.items, fetchedAt: cache.fetchedAt, fromCache: true, errors: [] };
  }
  const results = await Promise.allSettled(feeds.map(fetchOneFeed));
  const items = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else errors.push(`${feeds[i].source}: ${r.reason?.message ?? "failed"}`);
  });
  items.sort((a, b) => b.pubDate - a.pubDate);
  const merged = items.slice(0, MAX_ITEMS);
  // 全滅時は古いキャッシュを残す(「◯分前の情報」として出せる方が空より優しい)
  if (merged.length) cache = { fetchedAt: now, items: merged };
  return { items: cache.items, fetchedAt: cache.fetchedAt, fromCache: !merged.length, errors };
}

/**
 * キーワード簡易フィルタ(LLM無しモードの代役)。純関数・テスト対象。
 * できること: ブロック語の除外と興味トピックの単純一致だけ。
 * できないこと: つらさの文脈判定・やわらか要約・確度ラベル(すべて unrated になる)。
 */
export function keywordClassify(items, prefs = {}) {
  const interests = (prefs.interests ?? []).filter(Boolean);
  const blocked = prefs.blockedWords ?? FALLBACK_BLOCK_WORDS;
  return items
    .filter((it) => !blocked.some((w) => (it.title + it.summary).includes(w)))
    .map((it) => {
      const matched = interests.filter((t) => (it.title + it.summary).toLowerCase().includes(t.toLowerCase()));
      return {
        ...it,
        lane: matched.length ? "interest" : "general",
        matched_topics: matched,
        distress: "unrated",
        confidence: "unrated",
        gentle_summary: null, // 簡易モードでは元の要約をそのまま見せる(勝手に書き換えない)
        ai_comment: null,
      };
    });
}

// LLM分類の結果キャッシュ。同じ記事を二度分類しない=コスト管理。
// キーは「記事ID:興味リストのハッシュ」— 興味が変わったら同じ記事でも
// レーン判定が変わるべきなので、記事IDだけをキーにすると古い分類が残ってしまう。
export const classificationCache = new Map();
const CLASSIFICATION_CACHE_MAX = 2000;

/** 興味リスト→キャッシュキー用ハッシュ(純関数・テスト対象)。 */
export function prefsCacheKey(prefs = {}) {
  return createHash("sha1").update(JSON.stringify(prefs.interests ?? [])).digest("hex").slice(0, 8);
}

export function getCachedClassification(itemId, prefsKey) {
  return classificationCache.get(`${itemId}:${prefsKey}`);
}

export function setCachedClassification(itemId, prefsKey, classification) {
  classificationCache.set(`${itemId}:${prefsKey}`, classification);
  // 無限に育てない(古い挿入順から捨てる)
  while (classificationCache.size > CLASSIFICATION_CACHE_MAX) {
    classificationCache.delete(classificationCache.keys().next().value);
  }
}
