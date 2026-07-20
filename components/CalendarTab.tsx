"use client";

interface MockEvent {
  day: number;
  label: string;
  category: "task" | "appointment" | "med" | "personal";
}

const CATEGORY_STYLE: Record<MockEvent["category"], { icon: string; cls: string }> = {
  task: { icon: "✅", cls: "bg-mint-100 text-mint-700 dark:bg-mint-900/50 dark:text-mint-200" },
  appointment: { icon: "📌", cls: "bg-aqua-100 text-aqua-700 dark:bg-aqua-900/50 dark:text-aqua-200" },
  med: { icon: "💊", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200" },
  personal: { icon: "🌸", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200" },
};

// Local mock data for the first pass — no external calendar sync yet.
const MOCK_EVENTS: MockEvent[] = [
  { day: 3, label: "Dentist", category: "appointment" },
  { day: 3, label: "Vitamins", category: "med" },
  { day: 8, label: "Submit report", category: "task" },
  { day: 12, label: "Coffee w/ friend", category: "personal" },
  { day: 20, label: "Grocery run", category: "task" },
];

export default function CalendarTab() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <div className="scrollbar-thin h-full overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-3xl space-y-4 pb-10">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-mint-800 dark:text-mint-100">
            {today.toLocaleString(undefined, { month: "long" })} {year}
          </h1>
          <div className="flex flex-wrap gap-2 text-xs">
            {(Object.keys(CATEGORY_STYLE) as MockEvent["category"][]).map((c) => (
              <span key={c} className={`rounded-full px-2 py-1 ${CATEGORY_STYLE[c].cls}`}>
                {CATEGORY_STYLE[c].icon} {c}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-medium text-slate-500 dark:text-slate-400">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((day, i) => {
            const events = day ? MOCK_EVENTS.filter((e) => e.day === day) : [];
            const isToday = day === today.getDate();
            return (
              <div
                key={i}
                className={`min-h-20 rounded-xl2 border p-1.5 text-left align-top ${
                  day
                    ? isToday
                      ? "border-mint-400 bg-mint-50 shadow-glow dark:border-mint-500 dark:bg-slate-800"
                      : "border-mint-100 bg-white/70 dark:border-slate-800 dark:bg-slate-900/50"
                    : "border-transparent"
                }`}
              >
                {day && <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{day}</div>}
                <div className="mt-1 space-y-1">
                  {events.map((e, idx) => (
                    <div key={idx} className={`truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium ${CATEGORY_STYLE[e.category].cls}`}>
                      {CATEGORY_STYLE[e.category].icon} {e.label}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-slate-400">
          This calendar uses local mock events for now. External calendar sync is not implemented yet.
        </p>
      </div>
    </div>
  );
}
