import { getStatus, STATUS_META, STATUS_ORDER } from "../lib/data";

export default function StatsBar({ proposals, onFilterStatus }) {
  const counts = {};
  for (const p of proposals) {
    const s = getStatus(p);
    counts[s] = (counts[s] || 0) + 1;
  }

  const active = STATUS_ORDER.filter((s) => s !== "abandoned" && counts[s]);
  if (active.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 items-center">
      {active.map((status) => {
        const meta = STATUS_META[status];
        return onFilterStatus ? (
          <button
            key={status}
            type="button"
            onClick={() => onFilterStatus(status)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-white/80 dark:hover:bg-gray-800/60 border border-transparent hover:border-gray-200/80 dark:hover:border-gray-700 transition-all focus-ring"
            title={`Filter by ${meta.label}`}
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{counts[status]}</span>
            <span className="text-sm text-gray-500 dark:text-gray-400">{meta.label}</span>
          </button>
        ) : (
          <div key={status} className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{counts[status]}</span>
            <span className="text-sm text-gray-500 dark:text-gray-400">{meta.label}</span>
          </div>
        );
      })}
    </div>
  );
}
