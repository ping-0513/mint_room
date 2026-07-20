import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const app = await readFile(new URL("./app.js", import.meta.url), "utf8");

test("未実装のSafety設定は押せず、placeholderと理由が表示される", () => {
  for (const id of ["set-safetyMode", "set-moderationPrecheck", "set-moderationBehavior", "set-promptCacheKey"]) {
    assert.match(html, new RegExp(`id=["']${id}["'][^>]*disabled`));
  }
  assert.match(html, /Safety mode <span class="badge">placeholder<\/span>/);
  assert.match(html, /Stricter and development modes are not implemented yet/);
});

test("無効化したSafety設定をJavaScriptが再び保存対象にしない", () => {
  const fields = app.slice(app.indexOf("const SETTING_FIELDS"), app.indexOf("function bindSettings"));
  for (const id of ["set-safetyMode", "set-moderationPrecheck", "set-moderationBehavior", "set-promptCacheKey"]) {
    assert.doesNotMatch(fields, new RegExp(id));
  }
});
