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

test("Skill Packの自動選択は利用者が無効化でき、内部指示は画面に置かない", () => {
  assert.match(html, /id="set-skillPacksEnabled"/);
  assert.doesNotMatch(html, /id="set-skillPacksEnabled"[^>]*disabled/);
  const fields = app.slice(app.indexOf("const SETTING_FIELDS"), app.indexOf("function bindSettings"));
  assert.match(fields, /skillPacksEnabled/);
  assert.match(app, /data\.activeSkills/);
  assert.doesNotMatch(html, /Built-in Skill Pack:/);
});

test("利用料金は手動為替・両端を含む日付範囲・期間計と全期間計を表示する", () => {
  for (const id of [
    "set-usdJpyRate", "costFrom", "costTo", "costRangeMain", "costAllMain",
    "costLatest", "costHistoryList", "costStorageWarning",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /type="date" id="costFrom"/);
  assert.match(html, /type="date" id="costTo"/);
  assert.match(html, /選択期間（両端を含む）/);
  assert.match(html, /このブラウザでの全期間/);
  assert.match(html, /請求書、税、契約割引/);
  assert.match(html, /<script type="module" src="app\.js"><\/script>/);
  assert.match(app, /appendUsageEvents/);
  assert.match(app, /data\.usageEvents/);
  assert.match(app, /costEventIds/);
});

test("USD/JPY設定の保存経路はchangeイベントだけが所有する", () => {
  const fields = app.slice(app.indexOf("const SETTING_FIELDS"), app.indexOf("function bindSettings"));
  assert.match(fields, /usdJpyRate/);
  const dashboardBindings = app.slice(
    app.indexOf("function bindCostDashboard"),
    app.indexOf('window.addEventListener("storage"')
  );
  assert.doesNotMatch(dashboardBindings, /set-usdJpyRate/);
});

test("GPT-4o旧aliasの移行と未知モデルの明示表示を行い、既定へ黙って落とさない", () => {
  assert.match(app, /migrateStableModelSettings/);
  assert.match(app, /Unavailable:/);
  assert.match(app, /課金前に別のモデルを選んでください/);
  assert.doesNotMatch(app, /settings\.model\s*=\s*data\.defaultModel/);
});

test("Newsはタブを開いただけで有料分類せず、失敗理由もno API keyと決めつけない", () => {
  const tabHandler = app.slice(app.indexOf('$("tabs")'), app.indexOf("/* ---------- Chat ---------- */"));
  assert.doesNotMatch(tabHandler, /loadNewsFeed/);
  assert.match(html, /Refreshすると、APIキー設定時/);
  for (const reason of ["no_key", "provider_error", "invalid_json", "invalid_model"]) {
    assert.match(app, new RegExp(reason));
  }
});

test("Backupは検証前にdownloadせず、進行中AIと復元後の古いsaveを遮断する", () => {
  for (const id of [
    "exportDataBtn", "importDataBtn", "importDataFile", "importPreview",
    "importPreviewHeading", "importBlockedReason", "confirmImportBtn", "cancelImportBtn", "backupStatus",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /id="importPreviewHeading"[^>]*tabindex="-1"/);
  assert.match(html, /id="backupStatus"[^>]*tabindex="-1"/);
  const backupSection = app.slice(
    app.indexOf("\/\* ---------- データのバックアップ / 復元 ---------- \*\/"),
    app.indexOf("\/\* ---------- API利用額台帳 ---------- \*\/")
  );
  const exportSection = backupSection.slice(
    backupSection.indexOf("async function exportAllData"),
    backupSection.indexOf("function resetImportPreview")
  );
  assert.ok(exportSection.indexOf("inspectBackupText(text)") < exportSection.indexOf("downloadBackupDocument(documentValue"));
  assert.match(backupSection, /hasActiveDataWrites\(\)/);
  assert.match(backupSection, /checkImportPlanCurrent\(localStorage/);
  assert.match(backupSection, /importCommitted = true;[\s\S]*applyImportPlan/);
  assert.match(backupSection, /window\.location\.reload\(\);/);
  assert.doesNotMatch(backupSection, /setTimeout\(\(\) => window\.location\.reload/);
  assert.match(backupSection, /setBackupBusy\(false\);\s*\$\("confirmImportBtn"\)\.focus\(\);/);
  assert.match(backupSection, /rollbackOk === false[\s\S]*\$\("backupStatus"\)\.focus\(\);/);
  assert.match(app, /function save\(key, value\) \{\s*if \(importCommitted\) return false;/);
});
