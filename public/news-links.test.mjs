// ブラウザ側の二重防御が外れて危険URLを直接hrefへ戻さないための静的回帰テスト。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("./app.js", import.meta.url), "utf8");

test("ニュース描画は生のRSSリンクをhrefへ代入しない", () => {
  assert.doesNotMatch(appSource, /title\.href\s*=\s*it\.link/);
  assert.match(appSource, /const safeLink = normalizeNewsUrl\(it\.link\)/);
  assert.match(appSource, /document\.createElement\(safeLink \? "a" : "span"\)/);
});

test("クライアントのニュースURL許可リストはHTTPとHTTPSだけ", () => {
  assert.match(appSource, /url\.protocol === "http:" \|\| url\.protocol === "https:"/);
  assert.match(appSource, /title\.href = safeLink/);
});
