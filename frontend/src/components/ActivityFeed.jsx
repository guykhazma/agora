import { useMemo } from "react";
import { SOURCE_META, getStatus, STATUS_META, relativeTime } from "../lib/data";
import { cleanTitle } from "../lib/utils";

const DAYS_90 = 90 * 86400000;

export default function ActivityFeed({ proposals, onSelect, crossSourceInitIds }) {
  const recent = useMemo(() => {
    return [...proposals]
      .filter((p) => p.updated_at)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 12);
  }, [proposals]);

  if (recent.length === 0) return null;

  return (
    <aside className="w-72 flex-shrink-0">
      <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
        Recent Activity
      </h2>
      <div className="flex flex-col gap-1.5">
        {recent.map((p) => {
          const status = getStatus(p);
          const statusMeta = STATUS_META[status];
          const sourceMeta = SOURCE_META[p.source] || { label: p.source };
          const stale = Date.now() - new Date(p.updated_at).getTime() > DAYS_90;

          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p)}
              className="text-left w-full px-3 py-2.5 rounded-xl bg-white/90 dark:bg-gray-900/90 hover:bg-gray-50/90 dark:hover:bg-gray-800/80 border border-gray-200/90 dark:border-gray-700 hover:border-agora-200/80 dark:hover:border-gray-600 transition-all shadow-sm hover:shadow focus-ring group"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusMeta.dot}`} />
                <span className="text-xs text-gray-400 dark:text-gray-500">{sourceMeta.label}</span>
                <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
                  {stale ? "stale" : relativeTime(p.updated_at)}
                </span>
              </div>
              <p className="text-xs text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 leading-snug line-clamp-2">
                {cleanTitle(p)}
              </p>
              {crossSourceInitIds?.has(p.initiative_id) && (
                <span className="mt-1 inline-block text-xs px-1 py-0.5 rounded bg-agora-50 dark:bg-agora-900/30 text-agora-700 dark:text-agora-300">
                  multi-channel
                </span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
