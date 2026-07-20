// mint room frontend. No frameworks, no build step.
// State: chat + settings + life lists live in localStorage only (no server persistence).

import {
  appendUsageEvents,
  filterCostEvents,
  formatEventCost,
  formatJpyMicros,
  formatStoredLocalTimestamp,
  formatUsdNano,
  localDateKey,
  migrateStableModelSettings,
  mergeCostLedgers,
  parseCostLedger,
  parseFxRateToMicros,
  summarizeCostEvents,
  validateDateRange,
} from "./costs.js";
import {
  applyImportPlan,
  backupFilename,
  checkImportPlanCurrent,
  createBackupDocument,
  finalizeImportPlan,
  inspectBackupText,
  isBackupFileSizeAllowed,
  MAX_BACKUP_BYTES,
  MINTROOM_STORAGE_KEYS,
  prepareImport,
  serializeBackupDocument,
} from "./backup.js";

const LS = MINTROOM_STORAGE_KEYS;
let importCommitted = false; // 復元write後からreloadまで、古い非同期応答の再保存を止める

const DEFAULT_SETTINGS = {
  theme: "system",
  model: "gpt-4.1-mini",
  reasoningEffort: "default",
  developerInstructions: "",
  persona: "",
  temperature: 1,
  topP: 1,
  maxOutputTokens: 2048,
  responseFormat: "text",
  safetyMode: "standard",
  moderationPrecheck: false,
  moderationBehavior: "block",
  store: false,
  promptCacheKey: "",
  historyLimit: 20,
  skillPacksEnabled: true,
  // 空欄ならUSDだけを記録する。古くなる固定為替を暗黙の既定値にはしない。
  usdJpyRate: "",
};

let settings = loadJSON(LS.settings, DEFAULT_SETTINGS);
settings = { ...DEFAULT_SETTINGS, ...settings };
const stableModelMigration = migrateStableModelSettings(settings);
settings = stableModelMigration.settings;
const stableModelMigrationSaved = !stableModelMigration.changed || save(LS.settings, settings);
let chat = loadJSON(LS.chat, { messages: [] }); // [{role:"user"|"assistant", content}]
let life = loadJSON(LS.life, {
  wakeTime: "", sleepTime: "",
  tasks: [], shopping: [], medication: [], // [{text, done}]
});
let diary = loadJSON(LS.diary, { entries: {} }); // entries keyed by "YYYY-MM-DD"
let news = loadJSON(LS.news, { interests: [], hiddenIds: [], lastResult: null });
const initialCostLoad = loadCostLedger();
let costLedger = initialCostLoad.ledger;
let costLedgerWritable = initialCostLoad.ok;
let costPersistenceWarning = initialCostLoad.error ?? "";
let costMigrationWarning = stableModelMigrationSaved
  ? ""
  : "GPT-4o固定版への設定移行を保存できませんでした。再読み込み後も必ずモデル選択を確認してください。";
let costSettingsWarning = "";
let costEventWarning = "";
const initialCostDate = localDateKey();
let costRange = { from: `${initialCostDate.slice(0, 8)}01`, to: initialCostDate };
let serverModels = null; // fetched from /api/status
let serverSkillPacks = []; // /api/statusから受け取る公開メタデータだけを保持する
let skillPackCatalogState = "loading"; // loading / ready / error を分け、誤ったoffline表示を避ける
let sending = false;     // double-send guard
let diaryBusy = false;   // double-generate guard
let newsBusy = false;    // ニュース更新の連打ガード
let backupBusy = false;  // export/importの連打と重複writeを防ぐ
let pendingImport = null;
let importReadGeneration = 0; // 遅い旧ファイル読込が新しいpreviewを上書きしないための世代番号

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : structuredClone(fallback);
  } catch { return structuredClone(fallback); }
}
function save(key, value) {
  if (importCommitted) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function loadCostLedger() {
  try {
    return parseCostLedger(localStorage.getItem(LS.costs));
  } catch {
    return {
      ok: false,
      ledger: parseCostLedger(null).ledger,
      error: "利用額の保存領域を読み取れません。新しい記録はこの再読み込み後に失われます。",
    };
  }
}
const $ = (id) => document.getElementById(id);

/* ---------- Theme ---------- */
function applyTheme() {
  const pref = settings.theme;
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

/* ---------- Tabs ---------- */
$("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === btn));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${btn.dataset.tab}`));
  // Newsはタブを開いただけでは更新しない。有料AI分類はRefreshという明示操作だけで始める。
});

/* ---------- Chat ---------- */
const chatLog = $("chatLog"), chatInput = $("chatInput"), sendBtn = $("sendBtn"),
  regenBtn = $("regenBtn"), chatError = $("chatError"), chatErrorText = $("chatErrorText");
let lastFailedAction = null; // () => Promise, for Retry

function renderChat() {
  chatLog.innerHTML = "";
  if (chat.messages.length === 0 && !sending) {
    const div = document.createElement("div");
    div.className = "empty-chat";
    div.textContent = "🌿 Welcome to your mint room. Ask me anything!";
    chatLog.appendChild(div);
  }
  for (const m of chat.messages) {
    const div = document.createElement("div");
    div.className = `msg ${m.role}`;
    const content = document.createElement("div");
    content.className = "msg-content";
    content.textContent = m.content;
    div.appendChild(content);
    if (m.role === "assistant" && Array.isArray(m.activeSkills) && m.activeSkills.length) {
      const skills = document.createElement("div");
      skills.className = "msg-skills";
      const context = document.createElement("span");
      context.className = "skill-context";
      context.textContent = "Skill Pack:";
      skills.appendChild(context);
      for (const skill of m.activeSkills.slice(0, 1)) {
        if (!skill || typeof skill.id !== "string" || typeof skill.label !== "string") continue;
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.dataset.skillId = skill.id;
        const catalogPack = serverSkillPacks.find((pack) => pack.id === skill.id);
        badge.textContent = `${catalogPack?.emoji ?? "🧩"} ${skill.label}`;
        skills.appendChild(badge);
      }
      if (skills.childElementCount > 1) div.appendChild(skills);
    }
    if (m.role === "assistant" && Array.isArray(m.costEventIds) && m.costEventIds.length) {
      const cost = document.createElement("div");
      cost.className = "msg-cost";
      cost.textContent = formatCostEventIds(m.costEventIds);
      div.appendChild(cost);
    }
    if (m.role === "assistant") {
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      actions.appendChild(createCopyButton(m.content));
      div.appendChild(actions);
    }
    chatLog.appendChild(div);
  }
  if (sending) {
    const div = document.createElement("div");
    div.className = "msg assistant pending";
    div.innerHTML = '<span class="spark">✨</span> thinking…';
    chatLog.appendChild(div);
  }
  chatLog.scrollTop = chatLog.scrollHeight;
  updateChatButtons();
}

function createCopyButton(messageText) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn small ghost copy-message-btn";
  button.textContent = "Copy";
  button.title = "Copy this answer";
  button.setAttribute("aria-live", "polite");
  button.setAttribute("aria-atomic", "true");
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Copying…";
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(String(messageText ?? ""));
      button.textContent = "✓ copied";
    } catch {
      button.textContent = "Copy failed";
    }
    // ボタンごとに復帰を管理し、連打や別メッセージのコピーと干渉させない。
    window.setTimeout(() => {
      button.textContent = "Copy";
      button.disabled = false;
    }, 1500);
  });
  return button;
}

function updateChatButtons() {
  const modelUnavailable = Array.isArray(serverModels) && !serverModels.some((model) => model.id === settings.model);
  sendBtn.disabled = sending || modelUnavailable;
  regenBtn.disabled = sending || modelUnavailable || !chat.messages.some((m) => m.role === "user");
  $("clearChatBtn").disabled = sending;
}

function showError(msg, retryFn) {
  chatErrorText.textContent = msg;
  lastFailedAction = retryFn;
  chatError.classList.remove("hidden");
}
function hideError() { chatError.classList.add("hidden"); lastFailedAction = null; }

async function callChatAPI(messages) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings, messages }),
  });
  const data = await res.json().catch(() => null);
  if (!data?.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status})`);
  return {
    text: String(data.text ?? ""),
    activeSkills: Array.isArray(data.activeSkills) ? data.activeSkills.slice(0, 1) : [],
    usageEvents: Array.isArray(data.usageEvents) ? data.usageEvents : [],
  };
}

// Send a new user message. Input clears only on successful send-start;
// on failure the text is restored so nothing is lost.
async function sendMessage() {
  if (sending || backupBusy || importCommitted) return; // 復元と同時に古いstateを書かない
  const text = chatInput.value.trim();
  if (!text) return;
  hideError();
  chat.messages.push({ role: "user", content: text, ts: Date.now() });
  chatInput.value = "";
  sending = true;
  updateBackupControls();
  renderChat();
  try {
    const reply = await callChatAPI(chat.messages);
    const costEventIds = recordProviderUsage(reply.usageEvents);
    chat.messages.push({ role: "assistant", content: reply.text, activeSkills: reply.activeSkills, costEventIds, ts: Date.now() });
    save(LS.chat, chat);
  } catch (err) {
    // Roll back the optimistic user turn so Retry re-sends cleanly.
    chat.messages.pop();
    // Restore the failed text, but never clobber something newly typed.
    if (!chatInput.value.trim()) chatInput.value = text;
    showError(err.message, sendMessage);
  } finally {
    sending = false;
    updateBackupControls();
    renderChat();
    chatInput.focus();
  }
}

// Regenerate: re-request a reply for the SAME last user turn.
// Removes the trailing assistant reply (if any); never duplicates the user message.
async function regenerate() {
  if (sending || backupBusy || importCommitted) return;
  const lastUserIdx = chat.messages.map((m) => m.role).lastIndexOf("user");
  if (lastUserIdx === -1) return;
  hideError();
  const removed = chat.messages.splice(lastUserIdx + 1); // drop old assistant reply
  sending = true;
  updateBackupControls();
  renderChat();
  try {
    const reply = await callChatAPI(chat.messages);
    const costEventIds = recordProviderUsage(reply.usageEvents);
    chat.messages.push({ role: "assistant", content: reply.text, activeSkills: reply.activeSkills, costEventIds, ts: Date.now() });
    save(LS.chat, chat);
  } catch (err) {
    chat.messages.push(...removed); // restore previous reply on failure
    showError(err.message, regenerate);
  } finally {
    sending = false;
    updateBackupControls();
    renderChat();
  }
}

$("chatForm").addEventListener("submit", (e) => { e.preventDefault(); sendMessage(); });
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
});
regenBtn.addEventListener("click", regenerate);
$("retryBtn").addEventListener("click", () => { const fn = lastFailedAction; hideError(); fn?.(); });
$("dismissErrorBtn").addEventListener("click", hideError);
$("clearChatBtn").addEventListener("click", () => {
  if (chat.messages.length && !confirm("Clear this conversation?")) return;
  chat.messages = [];
  save(LS.chat, chat);
  hideError();
  renderChat();
});

/* ---------- Settings ---------- */
const SETTING_FIELDS = [
  ["theme", "set-theme"], ["model", "set-model"], ["reasoningEffort", "set-reasoningEffort"],
  ["developerInstructions", "set-developerInstructions"], ["persona", "set-persona"],
  ["temperature", "set-temperature", "number"], ["topP", "set-topP", "number"],
  ["maxOutputTokens", "set-maxOutputTokens", "number"], ["responseFormat", "set-responseFormat"],
  ["store", "set-store", "checkbox"], ["historyLimit", "set-historyLimit", "number"],
  ["skillPacksEnabled", "set-skillPacksEnabled", "checkbox"],
  ["usdJpyRate", "set-usdJpyRate"],
];

function bindSettings() {
  for (const [key, id, kind] of SETTING_FIELDS) {
    const el = $(id);
    if (!el) continue;
    if (kind === "checkbox") el.checked = Boolean(settings[key]);
    else el.value = settings[key];
    el.addEventListener("change", () => {
      const nextValue = kind === "checkbox" ? el.checked : kind === "number" ? Number(el.value) : el.value.trim();
      if (key === "usdJpyRate" && nextValue !== "" && parseFxRateToMicros(nextValue) === null) {
        el.setCustomValidity("1〜1000のUSD/JPYレートを入力してください。");
        el.reportValidity();
        el.value = settings[key];
        return;
      }
      el.setCustomValidity("");
      settings[key] = nextValue;
      const saved = save(LS.settings, settings);
      if (!saved && key === "usdJpyRate") {
        costSettingsWarning = "USD/JPY設定を保存できませんでした。再読み込み後に失われます。";
      }
      if (saved && key === "usdJpyRate") costSettingsWarning = "";
      if (saved && key === "model") costMigrationWarning = "";
      if (key === "theme") applyTheme();
      if (key === "model") updateModelDependentUI();
      if (key === "usdJpyRate") renderCostDashboard();
    });
  }
}

function renderSkillPackCatalog() {
  const catalog = $("skillPackCatalog");
  catalog.innerHTML = "";
  if (skillPackCatalogState === "loading") {
    const loading = document.createElement("span");
    loading.className = "hint";
    loading.textContent = "Loading built-in Skill Packs…";
    catalog.appendChild(loading);
    return;
  }
  if (!serverSkillPacks.length) {
    const empty = document.createElement("span");
    empty.className = "hint";
    empty.textContent = skillPackCatalogState === "error"
      ? "Skill Pack list is unavailable while the server is offline."
      : "This server did not report any built-in Skill Packs.";
    catalog.appendChild(empty);
    return;
  }
  for (const pack of serverSkillPacks) {
    const item = document.createElement("div");
    item.className = "skill-pack-item";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `${pack.emoji ?? "🧩"} ${pack.label ?? pack.id}`;
    const description = document.createElement("span");
    description.textContent = pack.description ?? "";
    item.append(badge, description);
    catalog.appendChild(item);
  }
}

// status到着時は会話全体を再描画せず、表示中のSkill絵文字だけを差し替える。
function refreshVisibleSkillBadges() {
  for (const badge of document.querySelectorAll(".msg-skills .badge[data-skill-id]")) {
    const pack = serverSkillPacks.find((candidate) => candidate.id === badge.dataset.skillId);
    if (pack) badge.textContent = `${pack.emoji ?? "🧩"} ${pack.label}`;
  }
}

function updateModelDependentUI() {
  const m = serverModels?.find((x) => x.id === settings.model);
  const effortSel = $("set-reasoningEffort");
  const supported = Boolean(m?.supportsReasoningEffort);
  effortSel.disabled = !supported;
  $("reasoningHint").textContent = supported
    ? "Sent as reasoning.effort (default omits the parameter)."
    : `Not supported by ${m?.label ?? settings.model} — control disabled.`;
  const tempSupported = m ? m.supportsTemperature : true;
  $("set-temperature").disabled = !tempSupported;
  $("set-topP").disabled = !tempSupported;
  const warning = $("modelStatusWarning");
  if (warning) {
    warning.textContent = Array.isArray(serverModels) && !m
      ? `保存されているモデル「${settings.model}」はこのサーバーでは使えません。課金前に別のモデルを選んでください。`
      : "";
    warning.classList.toggle("hidden", !warning.textContent);
  }
  updateChatButtons();
}

async function loadServerStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    serverModels = data.models;
    serverSkillPacks = Array.isArray(data.skillPacks) ? data.skillPacks : [];
    skillPackCatalogState = "ready";
    const sel = $("set-model");
    sel.innerHTML = "";
    for (const m of data.models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      sel.appendChild(opt);
    }
    if (!data.models.some((m) => m.id === settings.model)) {
      const unavailable = document.createElement("option");
      unavailable.value = settings.model;
      unavailable.textContent = `Unavailable: ${settings.model}`;
      unavailable.disabled = true;
      sel.prepend(unavailable);
    }
    sel.value = settings.model;
    $("keyStatus").textContent = data.hasApiKey ? "🔑 API key set" : "🌱 mock mode (no API key)";
    $("apiKeyHelp").innerHTML = data.hasApiKey
      ? "OpenAI API key is configured on the server."
      : "No OpenAI API key is set. The chat runs in <strong>mock mode</strong>. To enable real responses: set <code>OPENAI_API_KEY</code> in the server environment (see <code>.env.example</code>) and restart. The key stays server-side and is never sent to this page.";
    renderSkillPackCatalog();
    refreshVisibleSkillBadges();
    updateModelDependentUI();
  } catch {
    $("keyStatus").textContent = "⚠️ server unreachable";
    serverSkillPacks = [];
    skillPackCatalogState = "error";
    renderSkillPackCatalog();
  }
}

/* ---------- データのバックアップ / 復元 ---------- */
function showBackupStatus(message, { error = false } = {}) {
  const status = $("backupStatus");
  status.classList.toggle("error", error);
  status.setAttribute("role", error ? "alert" : "status");
  status.setAttribute("aria-live", error ? "assertive" : "polite");
  status.textContent = message;
}

function hasActiveDataWrites() {
  return sending || diaryBusy || newsBusy;
}

function yieldForPaint() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function updateBackupControls() {
  const recovery = pendingImport?.inspection?.costRecovery ?? null;
  const invalidCategories = pendingImport?.inspection?.invalidCategories ?? [];
  const consentNeeded = Boolean(recovery) || invalidCategories.length > 0;
  const consentGiven = $("costRecoveryConsent").checked;
  const activeWrites = hasActiveDataWrites();
  $("importBlockedReason").classList.toggle("hidden", !activeWrites);
  $("importBlockedReason").textContent = activeWrites
    ? "Chat・日記・ニュースの処理が終わるとImportできます。"
    : "";
  $("exportDataBtn").disabled = backupBusy;
  $("importDataBtn").disabled = backupBusy;
  $("importDataFile").disabled = backupBusy;
  $("cancelImportBtn").disabled = backupBusy;
  $("confirmImportBtn").disabled = backupBusy || activeWrites || !pendingImport || (consentNeeded && !consentGiven);
  $("confirmImportBtn").title = backupBusy
    ? "処理中です。"
    : activeWrites
      ? "Chat・日記・ニュースの処理が終わってからImportできます。"
    : !pendingImport
      ? "ファイルを確認してから実行できます。"
      : consentNeeded && !consentGiven
        ? "破損データの安全な扱いへ同意してください。"
        : "現在のデータを上書きして再読み込みします。";
}

function setBackupBusy(busy, message = "") {
  backupBusy = busy;
  if (message) showBackupStatus(message);
  $("importPreview").setAttribute("aria-busy", String(busy));
  updateBackupControls();
}

function downloadBackupDocument(backupDocument, filename, serializedText = null) {
  const text = serializedText ?? serializeBackupDocument(backupDocument);
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  try {
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // click処理がURLを受け取る前に破棄しないよう、次のタスクで解放する。
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return text;
}

async function exportAllData() {
  if (backupBusy) return;
  setBackupBusy(true, "✨ バックアップを準備しています…");
  await yieldForPaint();
  try {
    const now = new Date();
    const documentValue = createBackupDocument(localStorage, now);
    const text = serializeBackupDocument(documentValue);
    const inspection = inspectBackupText(text);
    if (!inspection.ok) {
      showBackupStatus(`復元可能なバックアップを作れないため、ダウンロードしませんでした。${inspection.error}`, { error: true });
      return;
    }
    downloadBackupDocument(documentValue, backupFilename(now), text);
    if (inspection.inspection.costRecovery || inspection.inspection.invalidCategories.length > 0) {
      showBackupStatus("バックアップのダウンロードを開始しました。破損rawもファイル内に保護され、Import時に安全な扱いを確認します。", { error: true });
    } else {
      showBackupStatus(`バックアップのダウンロードを開始しました（${documentValue.entries.filter((entry) => entry.present).length}項目）。`);
    }
  } catch (error) {
    showBackupStatus(error?.message || "バックアップを保存できませんでした。元データは変更していません。", { error: true });
  } finally {
    setBackupBusy(false);
  }
}

function resetImportPreview({ statusMessage = "", returnFocus = true } = {}) {
  importReadGeneration += 1;
  pendingImport = null;
  $("importPreview").classList.add("hidden");
  $("importPreviewList").innerHTML = "";
  $("costRecoveryConsent").checked = false;
  $("costRecoveryRow").classList.add("hidden");
  if (statusMessage) showBackupStatus(statusMessage);
  updateBackupControls();
  if (returnFocus) $("importDataBtn").focus();
}

function renderImportPreview(prepared) {
  pendingImport = prepared;
  const { inspection, counts } = prepared;
  const exportedAt = new Date(inspection.exportedAt).toLocaleString("ja-JP");
  const protectedNotes = [
    counts.protectedUnknownCount ? `未知キー保護${counts.protectedUnknownCount}` : "",
    counts.skippedInvalidCount ? `破損スキップ${counts.skippedInvalidCount}` : "",
  ].filter(Boolean);
  $("importPreviewMeta").textContent =
    `${exportedAt} のバックアップ · 新規${counts.newCount}・上書き${counts.overwriteCount}・削除${counts.removeCount}・変更なし${counts.unchangedCount}` +
    (protectedNotes.length ? `・${protectedNotes.join("・")}` : "");

  const list = $("importPreviewList");
  list.innerHTML = "";
  for (const item of inspection.previewItems) {
    const row = document.createElement("li");
    row.textContent = `${item.label}: ${item.detail}`;
    list.appendChild(row);
  }
  if (inspection.otherCount > 0) {
    const row = document.createElement("li");
    row.textContent = `その他のmintroomデータ: ${inspection.otherCount}項目`;
    list.appendChild(row);
  }

  const recovery = inspection.costRecovery;
  const invalidCategories = inspection.invalidCategories ?? [];
  const recoveryRow = $("costRecoveryRow");
  $("costRecoveryConsent").checked = false;
  const recoveryMessages = [];
  if (invalidCategories.length > 0) {
    recoveryMessages.push(
      `破損した${invalidCategories.map((item) => item.label).join("・")}はImport対象外にし、現在のデータを保持します。`
    );
  }
  if (recovery?.status === "recoverable") {
    recoveryMessages.push(`利用料金履歴は${recovery.recoveredCount}件を復元し、${recovery.rejectedCount}件を除外します。`);
  } else if (recovery?.status === "unrecoverable") {
    recoveryMessages.push("利用料金履歴のrawを解析できないため、履歴だけImport時点の0件から再開します。");
  }
  if (recoveryMessages.length > 0) {
    $("costRecoveryText").textContent = `${recoveryMessages.join(" ")} 元のrawは選択したバックアップファイルに残ります。この扱いに同意します。`;
    recoveryRow.classList.remove("hidden");
  } else {
    recoveryRow.classList.add("hidden");
  }
  $("importPreview").classList.remove("hidden");
  showBackupStatus("内容を確認してください。まだ端末内データは変更していません。");
  updateBackupControls();
  $("importPreviewHeading").focus();
}

async function readImportFile(file) {
  const generation = ++importReadGeneration;
  pendingImport = null;
  $("importPreview").classList.add("hidden");
  if (!isBackupFileSizeAllowed(file.size)) {
    showBackupStatus(`ファイルが大きすぎます（上限${Math.floor(MAX_BACKUP_BYTES / 1024 / 1024)}MB）。元データは変更していません。`, { error: true });
    updateBackupControls();
    $("importDataBtn").focus();
    return;
  }

  setBackupBusy(true, "✨ バックアップを確認しています…");
  try {
    const text = await file.text();
    if (generation !== importReadGeneration) return;
    const inspected = inspectBackupText(text);
    if (!inspected.ok) throw new Error(inspected.error);
    const prepared = prepareImport(localStorage, inspected.inspection);
    if (!prepared.ok) throw new Error(prepared.error);
    renderImportPreview(prepared.prepared);
  } catch (error) {
    if (generation === importReadGeneration) {
      pendingImport = null;
      showBackupStatus(`${error?.message || "ファイルを確認できませんでした。"} 元データは変更していません。`, { error: true });
      $("importDataBtn").focus();
    }
  } finally {
    if (generation === importReadGeneration) setBackupBusy(false);
  }
}

async function confirmImport() {
  if (backupBusy || !pendingImport) return;
  if (hasActiveDataWrites()) {
    showBackupStatus("Chat・日記・ニュースの処理が終わってからImportしてください。", { error: true });
    updateBackupControls();
    return;
  }
  const recovery = pendingImport.inspection.costRecovery;
  const invalidCategories = pendingImport.inspection.invalidCategories ?? [];
  const recoveryConfirmed = $("costRecoveryConsent").checked;
  if ((recovery || invalidCategories.length > 0) && !recoveryConfirmed) {
    showBackupStatus("破損データの安全な扱いへ同意してください。", { error: true });
    updateBackupControls();
    return;
  }
  const costRecoveryChoice = recovery?.status === "recoverable" && recoveryConfirmed
    ? "repair"
    : recovery?.status === "unrecoverable" && recoveryConfirmed
      ? "reset"
      : null;
  const approved = confirm(
    "現在のmint roomデータをバックアップ内容で上書きし、画面を再読み込みします。\n\n" +
    "次に復元前データのダウンロードを開始します。ほかのmint roomタブを閉じてから続けてください。"
  );
  if (!approved) {
    showBackupStatus("Importを中止しました。データは変更していません。");
    return;
  }

  setBackupBusy(true, "✨ 復元前バックアップを準備しています…");
  await yieldForPaint();
  try {
    const now = new Date();
    const finalized = finalizeImportPlan(pendingImport, {
      costRecoveryChoice,
      invalidCategoryChoice: invalidCategories.length > 0 && recoveryConfirmed ? "skip" : null,
      resetAt: now,
    });
    if (!finalized.ok) throw new Error(finalized.error);
    const current = checkImportPlanCurrent(localStorage, finalized.plan);
    if (!current.ok) {
      showBackupStatus(current.error, { error: true });
      setBackupBusy(false);
      if (current.changedSincePreview) resetImportPreview();
      else $("confirmImportBtn").focus();
      return;
    }
    const emergencyText = serializeBackupDocument(current.currentBackup);
    const emergencyInspection = inspectBackupText(emergencyText);
    if (!emergencyInspection.ok) throw new Error(`復元前バックアップを安全に作れません。${emergencyInspection.error}`);
    downloadBackupDocument(current.currentBackup, backupFilename(now, "mint-room-before-import"), emergencyText);
    const downloadConfirmed = confirm(
      "復元前バックアップのダウンロードを開始しました。\n\n" +
      "ブラウザのダウンロード表示を確認できた場合だけOKを押してください。キャンセルするとデータは変更しません。"
    );
    if (!downloadConfirmed) {
      showBackupStatus("Importを中止しました。データは変更していません。");
      setBackupBusy(false);
      $("confirmImportBtn").focus();
      return;
    }
    importCommitted = true;
    const result = applyImportPlan(localStorage, finalized.plan);
    if (!result.ok) {
      showBackupStatus(result.error, { error: true });
      if (result.rollbackOk === false) {
        // これ以上古いin-memory stateを書かず、緊急backupからの手動復旧を優先する。
        updateBackupControls();
        $("backupStatus").focus();
        return;
      }
      importCommitted = false;
      setBackupBusy(false);
      if (result.changedSincePreview) resetImportPreview();
      else $("confirmImportBtn").focus();
      return;
    }
    showBackupStatus("復元しました。画面を再読み込みします…");
    window.location.reload();
  } catch (error) {
    importCommitted = false;
    showBackupStatus(error?.message || "復元前バックアップを準備できなかったため、Importを開始しませんでした。", { error: true });
    setBackupBusy(false);
    $("confirmImportBtn").focus();
  }
}

function bindBackupTools() {
  $("exportDataBtn").addEventListener("click", exportAllData);
  $("importDataBtn").addEventListener("click", () => {
    if (backupBusy) return;
    const input = $("importDataFile");
    input.value = "";
    input.click();
  });
  $("importDataFile").addEventListener("change", (event) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (file) readImportFile(file);
  });
  $("costRecoveryConsent").addEventListener("change", updateBackupControls);
  $("confirmImportBtn").addEventListener("click", confirmImport);
  $("cancelImportBtn").addEventListener("click", () => {
    if (!backupBusy) resetImportPreview({ statusMessage: "Importを中止しました。データは変更していません。" });
  });
  updateBackupControls();
}

/* ---------- API利用額台帳 ---------- */
function recordProviderUsage(incoming) {
  if (importCommitted) return [];
  if (!Array.isArray(incoming) || incoming.length === 0) return [];
  let latestLedger = costLedger;
  if (costLedgerWritable) {
    try {
      const latestLoad = parseCostLedger(localStorage.getItem(LS.costs));
      if (!latestLoad.ok) {
        costLedgerWritable = false;
        costPersistenceWarning = latestLoad.error;
      } else {
        latestLedger = mergeCostLedgers(costLedger, latestLoad.ledger);
      }
    } catch {
      costLedgerWritable = false;
      costPersistenceWarning = "利用額の保存領域を再確認できません。新しい記録は再読み込み後に失われます。";
    }
  }
  const result = appendUsageEvents(latestLedger, incoming, { usdJpyRate: settings.usdJpyRate });
  costLedger = result.ledger;
  costEventWarning = "";
  if (result.rejectedCount > 0) {
    costEventWarning = `${result.rejectedCount}件の利用額イベントを安全に読み取れず、台帳へ追加しませんでした。`;
  }

  if (result.added.length > 0 && costLedgerWritable) {
    try {
      localStorage.setItem(LS.costs, JSON.stringify(costLedger));
    } catch {
      costLedgerWritable = false;
      costPersistenceWarning = "利用額を保存できませんでした。この画面には表示しますが、再読み込み後に失われます。空き容量を確認してください。";
    }
  }
  renderCostDashboard();

  // 既存Response IDの再受信も会話側から同じ台帳イベントを参照できるようにする。
  const requestedIds = incoming
    .map((event) => typeof event?.eventId === "string" ? event.eventId : null)
    .filter(Boolean);
  return [...new Set(requestedIds)].filter((id) => costLedger.events.some((event) => event.eventId === id));
}

function findCostEvents(eventIds) {
  const ids = new Set(Array.isArray(eventIds) ? eventIds : []);
  return costLedger.events.filter((event) => ids.has(event.eventId));
}

function formatCostEventIds(eventIds) {
  const events = findCostEvents(eventIds);
  if (events.length === 0) return "今回の利用額は記録されていません";
  if (events.length === 1) return formatEventCost(events[0]);
  const summary = summarizeCostEvents(events);
  return `今回 ${formatSummaryAmount(summary)} · ${events.length} API calls`;
}

function formatSummaryAmount(summary) {
  if (!summary || summary.callCount === 0) return "記録なし";
  if (summary.estimatedCount === 0) return "算出不可";
  const usd = formatUsdNano(summary.usdNano);
  if (summary.jpyConvertedCount === 0) return `約${usd}（円換算なし）`;
  const incomplete = summary.unconvertedCount > 0 ? ` + ${summary.unconvertedCount}件は円未換算` : "";
  return `約${formatJpyMicros(summary.jpyMicros)}${incomplete} (${usd})`;
}

function formatLedgerEventAmount(event) {
  if (event.status !== "estimated") {
    return event.status === "pricing_unavailable" ? "料金未登録・算出不可" : "usage未取得・算出不可";
  }
  const usd = formatUsdNano(event.usdNano);
  return event.jpyMicros === null ? `${usd}（円換算なし）` : `${formatJpyMicros(event.jpyMicros)} (${usd})`;
}

function formatFxMicros(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const micros = BigInt(value);
  const whole = micros / 1_000_000n;
  const fraction = String(micros % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function renderSummaryBlock(prefix, summary) {
  const main = $(`${prefix}Main`);
  const meta = $(`${prefix}Meta`);
  if (!main || !meta) return;
  main.textContent = formatSummaryAmount(summary);
  const notes = [`${summary.callCount}回`];
  if (summary.unavailableCount) notes.push(`${summary.unavailableCount}回は算出不可`);
  notes.push(`input ${summary.tokens.input.toLocaleString()} / cached ${summary.tokens.cachedInput.toLocaleString()} / output ${summary.tokens.output.toLocaleString()} tokens`);
  meta.textContent = notes.join(" · ");
}

function renderCostDashboard() {
  const fromInput = $("costFrom");
  const toInput = $("costTo");
  if (!fromInput || !toInput) return;
  fromInput.value = costRange.from;
  toInput.value = costRange.to;

  const rangeValidation = validateDateRange(costRange.from, costRange.to);
  const rangeError = $("costRangeError");
  rangeError.textContent = rangeValidation.ok ? "" : rangeValidation.error;
  rangeError.classList.toggle("hidden", rangeValidation.ok);

  const allEvents = costLedger.events;
  const rangedEvents = rangeValidation.ok ? filterCostEvents(allEvents, costRange.from, costRange.to) : [];
  renderSummaryBlock("costAll", summarizeCostEvents(allEvents));
  renderSummaryBlock("costRange", summarizeCostEvents(rangedEvents));

  const latest = [...allEvents].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0] ?? null;
  $("costLatest").textContent = latest ? `${purposeLabel(latest.purpose)} · ${formatLedgerEventAmount(latest)}` : "まだ記録はありません";

  const fxMicros = parseFxRateToMicros(settings.usdJpyRate);
  $("costFxStatus").textContent = fxMicros === null
    ? "円表示には手動レートが必要です。未設定中もUSDの利用額は記録します。"
    : `新しい呼び出しから 1 USD = ${settings.usdJpyRate} JPY で固定します。過去分は変更しません。`;
  $("costRecordingSince").textContent = `記録開始: ${new Date(costLedger.recordingStartedAt).toLocaleString("ja-JP")}`;

  const warning = $("costStorageWarning");
  const warningText = [costPersistenceWarning, costMigrationWarning, costSettingsWarning, costEventWarning]
    .filter(Boolean)
    .join(" ");
  warning.textContent = warningText;
  warning.classList.toggle("hidden", !warningText);

  const list = $("costHistoryList");
  list.innerHTML = "";
  if (!rangeValidation.ok || rangedEvents.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = rangeValidation.ok ? "この期間の利用記録はありません。" : "日付範囲を直すと履歴を表示します。";
    list.appendChild(empty);
    return;
  }

  const sorted = [...rangedEvents].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  for (const event of sorted.slice(0, 50)) {
    const row = document.createElement("div");
    row.className = "cost-history-row";
    const head = document.createElement("div");
    head.className = "cost-history-head";
    const label = document.createElement("strong");
    label.textContent = `${purposeLabel(event.purpose)} · ${formatLedgerEventAmount(event)}`;
    const time = document.createElement("time");
    time.dateTime = event.occurredAt;
    time.textContent = formatStoredLocalTimestamp(event);
    head.append(label, time);
    const details = document.createElement("div");
    details.className = "hint cost-history-details";
    const tokenText = event.tokens
      ? `input ${event.tokens.input.toLocaleString()} (cached ${event.tokens.cachedInput.toLocaleString()}) / output ${event.tokens.output.toLocaleString()}`
      : "tokens unavailable";
    const fxText = formatFxMicros(event.fxMicros);
    const priceReason = event.pricingUnavailableReason ? ` · unpriced: ${event.pricingUnavailableReason}` : "";
    const modelText = event.pricedModel === event.actualModel
      ? event.actualModel
      : `${event.actualModel} (priced as ${event.pricedModel})`;
    details.textContent = `${modelText} · ${tokenText} · ${fxText ? `1 USD = ${fxText} JPY` : "JPY rate not set"} · ${event.pricingVersion ?? "price version unavailable"}${priceReason}`;
    row.append(head, details);
    list.appendChild(row);
  }
  if (sorted.length > 50) {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = `この期間の最新50件を表示中（集計は${sorted.length}件すべてを含みます）。`;
    list.appendChild(note);
  }
}

function purposeLabel(purpose) {
  return { chat: "Chat", diary: "Diary", news: "News AI分類" }[purpose] ?? purpose;
}

function bindCostDashboard() {
  // 日付ピッカー選択の時点で即座に集計へ反映する。
  $("costFrom").addEventListener("input", (event) => {
    costRange = { ...costRange, from: event.target.value };
    renderCostDashboard();
  });
  $("costTo").addEventListener("input", (event) => {
    costRange = { ...costRange, to: event.target.value };
    renderCostDashboard();
  });
  renderCostDashboard();
}

// 別タブで利用額が増えた時も、次の自分の操作を待たず全期間表示へ反映する。
window.addEventListener("storage", (event) => {
  if (importCommitted) return;
  if (event.key !== LS.costs && event.key !== null) return;
  const incoming = parseCostLedger(event.newValue);
  // 別タブで明示的に削除された履歴は復活させず、その削除意図を優先する。
  if (event.newValue === null) {
    costLedger = incoming.ledger;
    costLedgerWritable = true;
    costPersistenceWarning = "";
    renderCostDashboard();
    return;
  }
  if (!incoming.ok) {
    costLedgerWritable = false;
    costPersistenceWarning = incoming.error;
  } else {
    const merged = mergeCostLedgers(costLedger, incoming.ledger);
    const incomingIds = new Set(incoming.ledger.events.map((item) => item.eventId));
    const needsUnionWrite = merged.recordingStartedAt !== incoming.ledger.recordingStartedAt ||
      merged.events.some((item) => !incomingIds.has(item.eventId));
    costLedger = merged;
    costLedgerWritable = true;
    costPersistenceWarning = "";
    // 同時writeで片方が最後に勝っても、storage event受信側が和集合を再保存して収束させる。
    if (needsUnionWrite) {
      try {
        localStorage.setItem(LS.costs, JSON.stringify(merged));
      } catch {
        costLedgerWritable = false;
        costPersistenceWarning = "複数タブの利用額を統合しましたが、保存できませんでした。再読み込み後に失われます。";
      }
    }
  }
  renderCostDashboard();
});

/* ---------- Life lists ---------- */
function renderList(container, key) {
  container.innerHTML = "";
  const ul = document.createElement("ul");
  ul.className = "list-items";
  life[key].forEach((item, i) => {
    const li = document.createElement("li");
    li.className = item.done ? "done" : "";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = item.done;
    cb.addEventListener("change", () => { item.done = cb.checked; save(LS.life, life); renderList(container, key); });
    const span = document.createElement("span");
    span.className = "item-text";
    span.textContent = item.text;
    const del = document.createElement("button");
    del.className = "btn small ghost";
    del.textContent = "✕";
    del.title = "Remove";
    del.addEventListener("click", () => { life[key].splice(i, 1); save(LS.life, life); renderList(container, key); });
    li.append(cb, span, del);
    ul.appendChild(li);
  });
  const addRow = document.createElement("form");
  addRow.className = "list-add";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Add…";
  const btn = document.createElement("button");
  btn.className = "btn small";
  btn.textContent = "＋";
  addRow.append(input, btn);
  addRow.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t) return;
    life[key].push({ text: t, done: false });
    save(LS.life, life);
    renderList(container, key);
  });
  container.append(ul, addRow);
}

function initLife() {
  document.querySelectorAll("[data-list]").forEach((el) => renderList(el, el.dataset.list));
  for (const id of ["wakeTime", "sleepTime"]) {
    const el = $(id);
    el.value = life[id] || "";
    el.addEventListener("change", () => { life[id] = el.value; save(LS.life, life); });
  }
}

/* ---------- Calendar (view-only, sample events) ---------- */
const SAMPLE_EVENTS = [
  { day: 3, label: "🩺 Clinic", cat: "health" },
  { day: 8, label: "🛍️ Groceries", cat: "errand" },
  { day: 14, label: "🎀 Movie night", cat: "fun" },
  { day: 21, label: "📌 Pay bills", cat: "task" },
  { day: 27, label: "🩺 Refill meds", cat: "health" },
];
let calCursor = new Date();

function renderCalendar() {
  const y = calCursor.getFullYear(), mo = calCursor.getMonth();
  $("calTitle").textContent = calCursor.toLocaleDateString(undefined, { year: "numeric", month: "long" });
  const grid = $("calGrid");
  grid.innerHTML = "";
  for (const d of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
    const el = document.createElement("div");
    el.className = "cal-dow";
    el.textContent = d;
    grid.appendChild(el);
  }
  const first = new Date(y, mo, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const today = new Date();
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const cell = document.createElement("div");
    cell.className = "cal-day";
    if (d.getMonth() !== mo) cell.classList.add("other");
    if (d.toDateString() === today.toDateString()) cell.classList.add("today");
    const num = document.createElement("div");
    num.className = "d";
    num.textContent = d.getDate();
    cell.appendChild(num);
    if (d.getMonth() === mo) {
      for (const ev of SAMPLE_EVENTS.filter((e) => e.day === d.getDate())) {
        const evEl = document.createElement("span");
        evEl.className = "cal-event";
        evEl.textContent = ev.label;
        cell.appendChild(evEl);
      }
    }
    grid.appendChild(cell);
  }
}
$("calPrev").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
$("calNext").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });

/* ---------- AI diary ---------- */
// The assistant writes its own gentle diary about the master's day.
// Raw generation happens server-side (/api/diary); entries live in localStorage.
const diaryWriteBtn = $("diaryWriteBtn"), diaryStatus = $("diaryStatus"),
  diaryError = $("diaryError"), diaryErrorText = $("diaryErrorText");

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildDiarySnapshot() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const todays = chat.messages.filter((m) => m.ts && m.ts >= start.getTime());
  return {
    date: todayKey(),
    visitedToday: todays.length > 0,
    conversation: todays.slice(-30).map((m) => ({ role: m.role, content: String(m.content).slice(0, 500) })),
    life: {
      tasksDone: life.tasks.filter((t) => t.done).length,
      tasksTotal: life.tasks.length,
      medsDone: life.medication.filter((m) => m.done).length,
      medsTotal: life.medication.length,
      shoppingCount: life.shopping.length,
      wakeTime: life.wakeTime,
      sleepTime: life.sleepTime,
    },
  };
}

function renderDiary() {
  const wrap = $("diaryEntries");
  wrap.innerHTML = "";
  const dates = Object.keys(diary.entries).sort().reverse();
  if (dates.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "No entries yet. Ask for today's entry to start the diary. 🌿";
    wrap.appendChild(p);
  }
  for (const date of dates) {
    const e = diary.entries[date];
    const card = document.createElement("div");
    card.className = "diary-entry";
    const head = document.createElement("div");
    head.className = "diary-head";
    const title = document.createElement("span");
    title.className = "diary-date";
    title.textContent = `📔 ${date}${e.mock ? " (mock)" : ""}`;
    const del = document.createElement("button");
    del.className = "btn small ghost";
    del.textContent = "✕";
    del.title = "Delete this entry";
    del.addEventListener("click", () => {
      if (!confirm(`Delete the diary entry for ${date}?`)) return;
      delete diary.entries[date];
      save(LS.diary, diary);
      renderDiary();
    });
    head.append(title, del);
    const body = document.createElement("p");
    body.className = "diary-text";
    body.textContent = e.text;
    card.append(head, body);
    if (Array.isArray(e.costEventIds) && e.costEventIds.length) {
      const cost = document.createElement("p");
      cost.className = "entry-cost";
      cost.textContent = formatCostEventIds(e.costEventIds).replace(/^今回/, "生成");
      card.appendChild(cost);
    }
    wrap.appendChild(card);
  }
  diaryWriteBtn.textContent = diary.entries[todayKey()] ? "Rewrite today's entry" : "Ask for today's entry";
  diaryWriteBtn.disabled = diaryBusy;
  diaryStatus.textContent = diaryBusy ? "✨ writing…" : "";
}

async function generateDiary() {
  if (diaryBusy || backupBusy || importCommitted) return; // 復元中は古いsnapshotを保存しない
  diaryBusy = true;
  updateBackupControls();
  diaryError.classList.add("hidden");
  renderDiary();
  try {
    const res = await fetch("/api/diary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings, snapshot: buildDiarySnapshot() }),
    });
    const data = await res.json().catch(() => null);
    if (!data?.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status})`);
    const costEventIds = recordProviderUsage(data.usageEvents);
    // Existing entry is only replaced after a successful response.
    diary.entries[todayKey()] = { text: data.text, generatedAt: Date.now(), mock: Boolean(data.mock), costEventIds };
    save(LS.diary, diary);
  } catch (err) {
    diaryErrorText.textContent = err.message;
    diaryError.classList.remove("hidden");
  } finally {
    diaryBusy = false;
    updateBackupControls();
    renderDiary();
  }
}

diaryWriteBtn.addEventListener("click", generateDiary);
$("diaryDismissBtn").addEventListener("click", () => diaryError.classList.add("hidden"));

/* ---------- やさしいニュース ---------- */
// 設計: docs/gentle-news-design.md。取得・分類はサーバー(/api/news)、
// 興味リストと「隠す」はこの端末のローカル保存のみ。
const newsRefreshBtn = $("newsRefreshBtn"), newsStatus = $("newsStatus"),
  newsError = $("newsError"), newsErrorText = $("newsErrorText");

const CONFIDENCE_BADGES = {
  confirmed: "🟢 公式",
  reported: "🔵 報道",
  rumor: "🟡 噂",
  speculation: "🟣 推測",
  unrated: "⚪ 未判定",
};
const LANE_HEADS = [
  ["interest", "🩷 あなたの好き"],
  ["rumor", "🟡 噂・体感(わくわく枠)"],
  ["essential", "💡 知っとくといいこと"],
  ["general", "📰 その他"],
];

function renderNewsInterests() {
  const wrap = $("newsInterestChips");
  wrap.innerHTML = "";
  for (const [i, topic] of news.interests.entries()) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = topic;
    const x = document.createElement("button");
    x.className = "chip-x";
    x.textContent = "✕";
    x.title = "Remove";
    x.addEventListener("click", () => {
      news.interests.splice(i, 1);
      save(LS.news, news);
      renderNewsInterests();
    });
    chip.appendChild(x);
    wrap.appendChild(chip);
  }
  if (!news.interests.length) {
    const p = document.createElement("span");
    p.className = "hint";
    p.textContent = "No topics yet — add what you love.";
    wrap.appendChild(p);
  }
}

function renderNews() {
  const wrap = $("newsList");
  wrap.innerHTML = "";
  const result = news.lastResult;
  newsRefreshBtn.disabled = newsBusy;
  if (newsBusy) {
    newsStatus.textContent = "✨ fetching gentle news…";
    // レイアウトを揺らさないためのプレースホルダ(master-preferences §2/§4)
    const ph = document.createElement("p");
    ph.className = "hint";
    ph.textContent = "🌿 …";
    wrap.appendChild(ph);
    return;
  }
  if (!result) {
    newsStatus.textContent = "";
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Press Refresh to fetch today's gentle news. 🌿";
    wrap.appendChild(p);
    return;
  }
  // fetchedAt=0 は「一度も取得成功していない」印なので経過時間を出さない
  const ageMin = result.fetchedAt ? Math.round((Date.now() - result.fetchedAt) / 60000) : null;
  const fallbackLabels = {
    no_key: "AI classification skipped (no API key)",
    provider_error: "AI classification failed; cached/simple results shown",
    invalid_json: "AI result invalid; cached/simple results shown",
    invalid_model: "AI classification skipped (model unavailable)",
  };
  const fallbackLabel = fallbackLabels[result.classificationFallbackReason] ?? null;
  const newsCost = Array.isArray(result.costEventIds) && result.costEventIds.length
    ? ` · ${formatCostEventIds(result.costEventIds).replace(/^今回 /, "AI分類 ")}`
    : "";
  newsStatus.textContent =
    (fallbackLabel ? `⚪ ${fallbackLabel} · ` : result.classifiedBy === "keyword" ? "⚪ simple keyword mode · " : "") +
    (ageMin === null ? "no fetch succeeded yet" : ageMin > 0 ? `${ageMin} min ago` : "just now") +
    (result.feedErrors?.length ? ` · ${result.feedErrors.length} feed(s) unavailable` : "") +
    newsCost;
  const visible = result.items.filter((it) => !news.hiddenIds.includes(it.id));
  let shown = 0;
  for (const [lane, head] of LANE_HEADS) {
    const laneItems = visible.filter((it) => it.lane === lane);
    if (!laneItems.length) continue;
    const h = document.createElement("h3");
    h.className = "news-lane-head";
    h.textContent = head;
    wrap.appendChild(h);
    for (const it of laneItems) {
      wrap.appendChild(renderNewsItem(it));
      shown++;
    }
  }
  if (!shown) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "今日は特にないよ。静かな日 🌿";
    wrap.appendChild(p);
  }
}

function renderNewsItem(it) {
  const card = document.createElement("div");
  card.className = "news-item" + (it.distress === "heavy" ? " news-heavy" : "");
  const head = document.createElement("div");
  head.className = "news-head";
  const badge = document.createElement("span");
  badge.className = `badge conf-${it.confidence}`;
  badge.textContent = CONFIDENCE_BADGES[it.confidence] ?? CONFIDENCE_BADGES.unrated;
  const src = document.createElement("span");
  src.className = "news-source";
  src.textContent = it.source;
  const hide = document.createElement("button");
  hide.className = "btn small ghost";
  hide.textContent = "隠す";
  hide.title = "この記事を表示しない(フィルタ学習の材料になります)";
  hide.addEventListener("click", () => {
    news.hiddenIds.push(it.id);
    if (news.hiddenIds.length > 500) news.hiddenIds = news.hiddenIds.slice(-300);
    save(LS.news, news);
    renderNews();
  });
  head.append(badge, src, hide);
  // 古いlocalStorageや将来の境界ミスも考慮し、表示直前にもWeb URLだけを許可する。
  const safeLink = normalizeNewsUrl(it.link);
  const title = document.createElement(safeLink ? "a" : "span");
  title.className = "news-title";
  if (safeLink) {
    title.href = safeLink;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
  }
  // 重いニュースは予告を先に付ける(不意打ちさせない)
  title.textContent = (it.distress === "heavy" ? "⚠️ " : "") + it.title;
  card.append(head, title);
  const summary = it.gentle_summary ?? it.summary;
  if (summary) {
    const p = document.createElement("p");
    p.className = "news-summary";
    p.textContent = summary;
    card.appendChild(p);
  }
  if (it.ai_comment) {
    const c = document.createElement("p");
    c.className = "news-comment";
    c.textContent = `🌿 ${it.ai_comment}`;
    card.appendChild(c);
  }
  return card;
}

function normalizeNewsUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

async function loadNewsFeed(force) {
  if (newsBusy || backupBusy || importCommitted) return; // 復元中は古いcacheを保存しない
  newsBusy = true;
  updateBackupControls();
  newsError.classList.add("hidden");
  renderNews();
  try {
    const res = await fetch("/api/news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings, force, prefs: { interests: news.interests } }),
    });
    const data = await res.json().catch(() => null);
    if (!data?.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status})`);
    const costEventIds = recordProviderUsage(data.usageEvents);
    // usageイベントは専用台帳だけに保存し、ニュースキャッシュへ重複させない。
    const { usageEvents: _usageEvents, ...newsResult } = data;
    news.lastResult = { ...newsResult, costEventIds };
    save(LS.news, news);
  } catch (err) {
    // 失敗しても前回の結果は消さない(古い情報でも空より優しい)
    newsErrorText.textContent = err.message;
    newsError.classList.remove("hidden");
  } finally {
    newsBusy = false;
    updateBackupControls();
    renderNews();
  }
}

newsRefreshBtn.addEventListener("click", () => loadNewsFeed(true));
$("newsDismissBtn").addEventListener("click", () => newsError.classList.add("hidden"));
$("newsInterestForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("newsInterestInput");
  const t = input.value.trim();
  if (!t || news.interests.includes(t)) return;
  news.interests.push(t);
  save(LS.news, news);
  input.value = "";
  renderNewsInterests();
});

/* ---------- Init ---------- */
applyTheme();
bindSettings();
bindBackupTools();
bindCostDashboard();
renderChat();
renderSkillPackCatalog();
initLife();
renderCalendar();
renderDiary();
renderNewsInterests();
renderNews();
loadServerStatus();
