export default function ProjectSelector({ projects, activeId, onChange }) {
  return (
    <div className="mb-6 flex flex-wrap gap-2 items-center">
      <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mr-1 font-medium">Project</span>
      {projects.map((p) => {
        const active = p.id === activeId;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-all shadow-sm focus-ring ${
              active
                ? "bg-gradient-to-r from-agora-600 to-agora-500 text-white ring-2 ring-agora-500/30 shadow-md shadow-agora-600/25"
                : "bg-white/90 dark:bg-gray-900/90 border border-gray-200/90 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-agora-300 dark:hover:border-agora-700 hover:bg-agora-50/50 dark:hover:bg-gray-800"
            }`}
          >
            {p.name}
          </button>
        );
      })}
    </div>
  );
}
