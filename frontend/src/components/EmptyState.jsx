export default function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center px-4 py-24 fade-in">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-agora-100 to-indigo-100 dark:from-agora-900/40 dark:to-indigo-900/40 text-3xl shadow-inner border border-white/50 dark:border-gray-700/50"
        aria-hidden
      >
        🏛️
      </div>
      <div className="max-w-md space-y-2">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">No projects yet</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
          Run the crawler or add a project under <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">projects/</code>.
          In CI, trigger <strong className="font-medium text-gray-800 dark:text-gray-200">Crawl &amp; Enrich</strong> to populate data.
        </p>
      </div>
      <a
        href="https://github.com/guykhazma/agora/actions"
        target="_blank"
        rel="noreferrer"
        className="mt-1 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-agora-600 to-agora-500 hover:from-agora-500 hover:to-agora-400 shadow-md shadow-agora-600/25 transition-all focus-ring"
      >
        Open GitHub Actions
      </a>
    </div>
  );
}
