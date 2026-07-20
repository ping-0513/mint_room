"use client";

import { useState } from "react";
import { useLocalStorageState } from "@/lib/use-local-storage";

interface Task {
  id: string;
  text: string;
  done: boolean;
}

interface Schedule {
  wake: string;
  sleep: string;
}

function newId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function ChecklistCard({
  title,
  icon,
  items,
  onAdd,
  onToggle,
  onRemove,
  placeholder,
}: {
  title: string;
  icon: string;
  items: Task[];
  onAdd: (text: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="rounded-xl2 border border-mint-100 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-mint-800 dark:text-mint-100">
        <span>{icon}</span> {title}
      </h2>
      <ul className="mb-3 space-y-1.5">
        {items.length === 0 && <li className="text-xs text-slate-400">Nothing here yet.</li>}
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={item.done} onChange={() => onToggle(item.id)} />
            <span className={`flex-1 ${item.done ? "text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"}`}>
              {item.text}
            </span>
            <button onClick={() => onRemove(item.id)} className="text-xs text-slate-400 hover:text-rose-500">
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          onAdd(draft.trim());
          setDraft("");
        }}
        className="flex gap-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-mint-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-mint-400 dark:border-slate-700 dark:bg-slate-800"
        />
        <button className="rounded-lg bg-mint-400 px-3 py-1.5 text-xs font-semibold text-white hover:bg-mint-500 dark:bg-mint-600">
          Add
        </button>
      </form>
    </div>
  );
}

function useChecklist(key: string) {
  const [items, setItems] = useLocalStorageState<Task[]>(key, []);
  return {
    items,
    add: (text: string) => setItems((prev) => [...prev, { id: newId(), text, done: false }]),
    toggle: (id: string) => setItems((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))),
    remove: (id: string) => setItems((prev) => prev.filter((t) => t.id !== id)),
  };
}

export default function LifeTab() {
  const [schedule, setSchedule] = useLocalStorageState<Schedule>("mintroom.life.schedule", { wake: "07:00", sleep: "23:00" });
  const tasks = useChecklist("mintroom.life.tasks");
  const shopping = useChecklist("mintroom.life.shopping");
  const meds = useChecklist("mintroom.life.meds");

  return (
    <div className="scrollbar-thin h-full overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-3xl space-y-4 pb-10">
        <h1 className="text-lg font-semibold text-mint-800 dark:text-mint-100">Life management 🌱</h1>

        <div className="rounded-xl2 border border-mint-100 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-mint-800 dark:text-mint-100">
            <span>🌙</span> Wake / sleep schedule
          </h2>
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300">
              Wake up
              <input
                type="time"
                value={schedule.wake}
                onChange={(e) => setSchedule((s) => ({ ...s, wake: e.target.value }))}
                className="rounded-lg border border-mint-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300">
              Sleep
              <input
                type="time"
                value={schedule.sleep}
                onChange={(e) => setSchedule((s) => ({ ...s, sleep: e.target.value }))}
                className="rounded-lg border border-mint-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800"
              />
            </label>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <ChecklistCard title="Tasks" icon="✅" items={tasks.items} onAdd={tasks.add} onToggle={tasks.toggle} onRemove={tasks.remove} placeholder="Add a task…" />
          <ChecklistCard title="Shopping list" icon="🛒" items={shopping.items} onAdd={shopping.add} onToggle={shopping.toggle} onRemove={shopping.remove} placeholder="Add an item…" />
          <ChecklistCard title="Medication" icon="💊" items={meds.items} onAdd={meds.add} onToggle={meds.toggle} onRemove={meds.remove} placeholder="Add a medication…" />
        </div>

        <p className="text-xs text-slate-400">Everything on this tab is stored locally in your browser only.</p>
      </div>
    </div>
  );
}
