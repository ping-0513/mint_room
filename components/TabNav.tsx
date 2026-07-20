"use client";

export type TabId = "chat" | "life" | "calendar" | "images" | "search" | "settings";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "life", label: "Life", icon: "🌱" },
  { id: "calendar", label: "Calendar", icon: "📅" },
  { id: "images", label: "Images", icon: "🖼️" },
  { id: "search", label: "Search", icon: "🔍" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

export default function TabNav({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  return (
    <nav
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-mint-100 bg-white/80 p-2 backdrop-blur
                 dark:border-slate-800 dark:bg-slate-900/80
                 md:h-dvh md:w-56 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:p-4"
    >
      <div className="hidden px-2 pb-4 md:block">
        <div className="text-lg font-semibold text-mint-700 dark:text-mint-200">✨ Mint Room</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">your gentle assistant</div>
      </div>
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`flex shrink-0 items-center gap-2 rounded-xl2 px-3 py-2 text-sm font-medium transition-colors
              ${
                isActive
                  ? "bg-mint-400/90 text-white shadow-glow dark:bg-mint-500/80"
                  : "text-slate-600 hover:bg-mint-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
          >
            <span aria-hidden>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
