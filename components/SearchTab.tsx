"use client";

import { useState } from "react";

export default function SearchTab() {
  const [query, setQuery] = useState("");

  return (
    <div className="scrollbar-thin h-full overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-2xl space-y-4 pb-10">
        <h1 className="text-lg font-semibold text-mint-800 dark:text-mint-100">Search 🔍</h1>
        <div className="rounded-xl2 border border-mint-100 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the web… (not wired up yet)"
              className="flex-1 rounded-lg border border-mint-200 bg-white px-3 py-2 text-sm outline-none focus:border-mint-400 dark:border-slate-700 dark:bg-slate-800"
            />
            <button disabled className="cursor-not-allowed rounded-lg border border-mint-200 px-3 py-2 text-xs font-medium text-slate-400 dark:border-slate-700">
              Search
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            This is an adapter boundary placeholder — no web/search tool call is made yet. Enable it later behind
            a server route, similar to <code>/api/chat</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
