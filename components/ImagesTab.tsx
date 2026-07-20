"use client";

export default function ImagesTab() {
  return (
    <div className="scrollbar-thin h-full overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-2xl space-y-4 pb-10">
        <h1 className="text-lg font-semibold text-mint-800 dark:text-mint-100">Images 🖼️</h1>
        <div className="rounded-xl2 border border-dashed border-mint-200 bg-white/70 p-6 text-center dark:border-slate-700 dark:bg-slate-900/50">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Image input</p>
          <p className="mt-1 text-xs text-slate-400">
            Not implemented yet — this is a placeholder entry point. Later: upload an image and ask the assistant
            about it via the chat route.
          </p>
          <button disabled className="mt-3 cursor-not-allowed rounded-lg border border-mint-200 px-3 py-1.5 text-xs font-medium text-slate-400 dark:border-slate-700">
            Upload image (coming soon)
          </button>
        </div>
        <div className="rounded-xl2 border border-dashed border-mint-200 bg-white/70 p-6 text-center dark:border-slate-700 dark:bg-slate-900/50">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Image generation</p>
          <p className="mt-1 text-xs text-slate-400">
            Not implemented yet — placeholder only. Later: a server-side route calling an OpenAI image model.
          </p>
          <button disabled className="mt-3 cursor-not-allowed rounded-lg border border-mint-200 px-3 py-1.5 text-xs font-medium text-slate-400 dark:border-slate-700">
            Generate image (coming soon)
          </button>
        </div>
      </div>
    </div>
  );
}
