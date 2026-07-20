// mint room frontend. No frameworks, no build step.
// State: chat + settings + life lists live in localStorage only (no server persistence).

"use strict";

const LS = {
  settings: "mintroom.settings.v1",
  chat: "mintroom.chat.v1",
  life: "mintroom.life.v1",
  diary: "mintroom.diary.v1",
  news: "mintroom.news.v1",
};

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
};

let settings = loadJSON(LS.settings, DEFAULT_SETTINGS);
settings = { ...DEFAULT_SETTINGS, ...settings };
let chat = loadJSON(LS.chat, { messages: [] }); // [{role:"user"|"assistant", content}]
let life = loadJSON(LS.life, {
  wakeTime: "", sleepTime: "",
  tasks: [], shopping: [], medication: [], // [{text, done}]
});
let diary = loadJSON(LS.diary, { entries: {} }); // entries keyed by "YYYY-MM-DD"
let news = loadJSON(LS.news, { interests: [], hiddenIds: [], lastResult: null });
let serverModels = null; // fetched from /api/status
let sending = false;     // double-send guard
let diaryBusy = false;   // double-generate guard
let newsBusy = false;    // ニュース更新の連打ガード

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : structuredClone(fallback);
  } catch { return structuredClone(fallback); }
}
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
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
  // Newsタブを開いた時、情報が古ければ自動更新(30分ルール)
  if (btn.dataset.tab === "news" && !newsBusy) {
    const age = Date.now() - (news.lastResult?.fetchedAt ?? 0);
    if (age > 30 * 60 * 1000) loadNewsFeed(false);
  }
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
    div.textContent = m.content;
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

function updateChatButtons() {
  sendBtn.disabled = sending;
  regenBtn.disabled = sending || !chat.messages.some((m) => m.role === "user");
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
  return data.text;
}

// Send a new user message. Input clears only on successful send-start;
// on failure the text is restored so nothing is lost.
async function sendMessage() {
  if (sending) return; // double-send guard
  const text = chatInput.value.trim();
  if (!text) return;
  hideError();
  chat.messages.push({ role: "user", content: text, ts: Date.now() });
  chatInput.value = "";
  sending = true;
  renderChat();
  try {
    const reply = await callChatAPI(chat.messages);
    chat.messages.push({ role: "assistant", content: reply, ts: Date.now() });
    save(LS.chat, chat);
  } catch (err) {
    // Roll back the optimistic user turn so Retry re-sends cleanly.
    chat.messages.pop();
    // Restore the failed text, but never clobber something newly typed.
    if (!chatInput.value.trim()) chatInput.value = text;
    showError(err.message, sendMessage);
  } finally {
    sending = false;
    renderChat();
    chatInput.focus();
  }
}

// Regenerate: re-request a reply for the SAME last user turn.
// Removes the trailing assistant reply (if any); never duplicates the user message.
async function regenerate() {
  if (sending) return;
  const lastUserIdx = chat.messages.map((m) => m.role).lastIndexOf("user");
  if (lastUserIdx === -1) return;
  hideError();
  const removed = chat.messages.splice(lastUserIdx + 1); // drop old assistant reply
  sending = true;
  renderChat();
  try {
    const reply = await callChatAPI(chat.messages);
    chat.messages.push({ role: "assistant", content: reply, ts: Date.now() });
    save(LS.chat, chat);
  } catch (err) {
    chat.messages.push(...removed); // restore previous reply on failure
    showError(err.message, regenerate);
  } finally {
    sending = false;
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
  ["safetyMode", "set-safetyMode"], ["moderationPrecheck", "set-moderationPrecheck", "checkbox"],
  ["moderationBehavior", "set-moderationBehavior"], ["store", "set-store", "checkbox"],
  ["promptCacheKey", "set-promptCacheKey"], ["historyLimit", "set-historyLimit", "number"],
];

function bindSettings() {
  for (const [key, id, kind] of SETTING_FIELDS) {
    const el = $(id);
    if (!el) continue;
    if (kind === "checkbox") el.checked = Boolean(settings[key]);
    else el.value = settings[key];
    el.addEventListener("change", () => {
      settings[key] = kind === "checkbox" ? el.checked : kind === "number" ? Number(el.value) : el.value;
      save(LS.settings, settings);
      if (key === "theme") applyTheme();
      if (key === "model") updateModelDependentUI();
    });
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
}

async function loadServerStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    serverModels = data.models;
    const sel = $("set-model");
    sel.innerHTML = "";
    for (const m of data.models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      sel.appendChild(opt);
    }
    if (!data.models.some((m) => m.id === settings.model)) {
      settings.model = data.defaultModel;
      save(LS.settings, settings);
    }
    sel.value = settings.model;
    $("keyStatus").textContent = data.hasApiKey ? "🔑 API key set" : "🌱 mock mode (no API key)";
    $("apiKeyHelp").innerHTML = data.hasApiKey
      ? "OpenAI API key is configured on the server."
      : "No OpenAI API key is set. The chat runs in <strong>mock mode</strong>. To enable real responses: set <code>OPENAI_API_KEY</code> in the server environment (see <code>.env.example</code>) and restart. The key stays server-side and is never sent to this page.";
    updateModelDependentUI();
  } catch {
    $("keyStatus").textContent = "⚠️ server unreachable";
  }
}

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
    wrap.appendChild(card);
  }
  diaryWriteBtn.textContent = diary.entries[todayKey()] ? "Rewrite today's entry" : "Ask for today's entry";
  diaryWriteBtn.disabled = diaryBusy;
  diaryStatus.textContent = diaryBusy ? "✨ writing…" : "";
}

async function generateDiary() {
  if (diaryBusy) return; // double-generate guard
  diaryBusy = true;
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
    // Existing entry is only replaced after a successful response.
    diary.entries[todayKey()] = { text: data.text, generatedAt: Date.now(), mock: Boolean(data.mock) };
    save(LS.diary, diary);
  } catch (err) {
    diaryErrorText.textContent = err.message;
    diaryError.classList.remove("hidden");
  } finally {
    diaryBusy = false;
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
  ["general", "📰 その他(簡易モード)"],
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
  newsStatus.textContent =
    (result.classifiedBy === "keyword" ? "⚪ simple keyword mode (no API key) · " : "") +
    (ageMin === null ? "no fetch succeeded yet" : ageMin > 0 ? `${ageMin} min ago` : "just now") +
    (result.feedErrors?.length ? ` · ${result.feedErrors.length} feed(s) unavailable` : "");
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
  const title = document.createElement("a");
  title.className = "news-title";
  title.href = it.link;
  title.target = "_blank";
  title.rel = "noopener noreferrer";
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

async function loadNewsFeed(force) {
  if (newsBusy) return; // 連打ガード
  newsBusy = true;
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
    news.lastResult = data;
    save(LS.news, news);
  } catch (err) {
    // 失敗しても前回の結果は消さない(古い情報でも空より優しい)
    newsErrorText.textContent = err.message;
    newsError.classList.remove("hidden");
  } finally {
    newsBusy = false;
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
renderChat();
initLife();
renderCalendar();
renderDiary();
renderNewsInterests();
renderNews();
loadServerStatus();
