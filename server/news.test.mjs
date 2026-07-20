// やさしいニュースのテスト。ネットワークを使わない純関数のみを対象にする
// (RSS取得そのものは実環境でしか検証できないため、パースと判断を固定する)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, normalizeNewsUrl, keywordClassify, FALLBACK_BLOCK_WORDS, prefsCacheKey, getCachedClassification, setCachedClassification } from "./news.mjs";
import { buildNewsPrompt } from "./openai.mjs";

const RSS_FIXTURE = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>テスト</title>
<item><title>新LLMが公開</title><link>https://example.com/a</link><description><![CDATA[<p>すごい<b>モデル</b>が出た</p>]]></description><pubDate>Sun, 20 Jul 2026 09:00:00 +0900</pubDate></item>
<item><title>リンク無し記事</title><description>捨てられるべき</description></item>
</channel></rss>`;

const ATOM_FIXTURE = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>r/test</title>
<entry><title>This model suddenly feels smarter??</title>
<link rel="alternate" href="https://example.com/reddit1"/>
<summary>no changelog but responses are way better</summary>
<updated>2026-07-20T01:00:00Z</updated></entry>
</feed>`;

const URL_SAFETY_RSS_FIXTURE = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<item><title>相対リンク</title><link>../article</link><description>safe</description></item>
<item><title>scriptリンク</title><link>javascript:alert(1)</link><description>unsafe</description></item>
<item><title>dataリンク</title><link>data:text/html,hello</link><description>unsafe</description></item>
</channel></rss>`;

const URL_SAFETY_ATOM_FIXTURE = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>相対Atomリンク</title><link rel="alternate" href="/atom-article"/></entry>
<entry><title>fileリンク</title><link rel="alternate" href="file:///tmp/private"/></entry>
</feed>`;

test("RSS2.0のフィードからタイトル・リンク・タグ除去済み要約が取れる", () => {
  const items = parseFeed(RSS_FIXTURE, "テスト");
  assert.equal(items.length, 1); // リンクの無い記事は捨てる
  assert.equal(items[0].title, "新LLMが公開");
  assert.equal(items[0].link, "https://example.com/a");
  assert.ok(!items[0].summary.includes("<")); // HTMLタグは残さない
  assert.equal(items[0].source, "テスト");
  assert.equal(items[0].id.length, 12);
});

test("Atomフィード(Reddit形式)もパースできる", () => {
  const items = parseFeed(ATOM_FIXTURE, "Reddit r/test");
  assert.equal(items.length, 1);
  assert.match(items[0].title, /feels smarter/);
  assert.equal(items[0].link, "https://example.com/reddit1");
});

test("ニュースURLはHTTP(S)だけを正規化し、相対URLはフィードを基準に解決する", () => {
  assert.equal(normalizeNewsUrl(" https://example.com/a "), "https://example.com/a");
  assert.equal(normalizeNewsUrl("http://example.com"), "http://example.com/");
  assert.equal(normalizeNewsUrl("../article", "https://feed.example/news/rss.xml"), "https://feed.example/article");
  assert.equal(normalizeNewsUrl("//cdn.example/item", "https://feed.example/rss.xml"), "https://cdn.example/item");
  for (const unsafe of [
    "javascript:alert(1)",
    " java\nscript:alert(1)",
    "data:text/html,hello",
    "file:///tmp/private",
    "blob:https://example.com/id",
    "mailto:test@example.com",
    "http://[",
    "",
  ]) {
    assert.equal(normalizeNewsUrl(unsafe, "https://feed.example/rss.xml"), null, unsafe);
  }
});

test("RSSとAtomは危険URLを除外し、正規化URLから安定IDを作る", () => {
  const rss = parseFeed(URL_SAFETY_RSS_FIXTURE, "RSS", "https://feed.example/news/rss.xml");
  assert.deepEqual(rss.map((item) => item.link), ["https://feed.example/article"]);
  const atom = parseFeed(URL_SAFETY_ATOM_FIXTURE, "Atom", "https://feed.example/feed.xml");
  assert.deepEqual(atom.map((item) => item.link), ["https://feed.example/atom-article"]);
  const canonical = parseFeed(
    `<rss><channel><item><title>x</title><link>https://feed.example/atom-article</link></item></channel></rss>`,
    "canonical"
  )[0];
  assert.equal(atom[0].id, canonical.id);
});

test("壊れたXMLでも例外にならず空配列が返る(タブ全体を壊さない)", () => {
  assert.deepEqual(parseFeed("<rss><channel><item><title>oops", "x"), []);
  assert.deepEqual(parseFeed("not xml at all", "x"), []);
});

test("同じURLの記事は再取得しても同じIDになる(分類キャッシュが効く)", () => {
  const a = parseFeed(RSS_FIXTURE, "s1")[0];
  const b = parseFeed(RSS_FIXTURE, "s2")[0];
  assert.equal(a.id, b.id);
});

test("簡易モードでは殺人事件などのブロック語を含む記事が表示されない", () => {
  const items = [
    { id: "1", title: "◯◯で殺人事件", summary: "", source: "s" },
    { id: "2", title: "新作コスメ登場", summary: "かわいい", source: "s" },
  ];
  const out = keywordClassify(items, { interests: [] });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "2");
});

test("簡易モードでも興味登録に一致した記事はinterestレーンに入る", () => {
  const items = [{ id: "1", title: "鬼滅の刃 映画の新情報", summary: "", source: "s" }];
  const out = keywordClassify(items, { interests: ["鬼滅の刃"] });
  assert.equal(out[0].lane, "interest");
  assert.deepEqual(out[0].matched_topics, ["鬼滅の刃"]);
  // 簡易モードは要約を書き換えない(勝手な生成をしない)
  assert.equal(out[0].gentle_summary, null);
  assert.equal(out[0].confidence, "unrated");
});

test("分類プロンプトには興味・ブロックカテゴリ・確度ラベルの指示が入る", () => {
  const { instructions, userContent } = buildNewsPrompt(
    [{ id: "abc", source: "s", title: "t", summary: "sum" }],
    { interests: ["LLM新モデル"] }
  );
  assert.match(userContent, /LLM新モデル/);
  assert.match(userContent, /"id":"abc"/);
  assert.match(instructions, /confidence/);
  assert.match(instructions, /Never present rumor as fact/);
  assert.match(instructions, /rumor/); // 噂レーンの存在
  assert.match(instructions, /tactics\/defenses, never victim tragedy detail/);
});

test("ブロック語リストに過剰ブロックしがちな一般語(死亡・事故など)が入っていない", () => {
  // 「死亡」を入れると災害・訃報など必要な情報まで消えるため、意図的に外している
  assert.ok(!FALLBACK_BLOCK_WORDS.includes("死亡"));
  assert.ok(!FALLBACK_BLOCK_WORDS.includes("事故"));
});

test("興味トピックを変えると分類キャッシュが効かなくなり再分類される", () => {
  const keyA = prefsCacheKey({ interests: ["LLM"] });
  const keyB = prefsCacheKey({ interests: ["LLM", "鬼滅の刃"] });
  assert.notEqual(keyA, keyB); // 興味が変わればキーも変わる
  setCachedClassification("item1", keyA, { lane: "general" });
  assert.equal(getCachedClassification("item1", keyA)?.lane, "general");
  assert.equal(getCachedClassification("item1", keyB), undefined); // 新しい興味では未分類扱い
});
