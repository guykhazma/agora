import { STATUS_ORDER, STATUS_META, SOURCE_META, TYPE_ORDER, TYPE_META, getStatus, getItemType } from "../lib/data";

export default function FilterBar({
  proposals,
  filterStatus,
  filterSource,
  filterType,
  onStatusChange,
  onSourceChange,
  onTypeChange,
}) {
  const usedStatuses = [...new Set(proposals.map(getStatus))];
  const usedSources = [...new Set(proposals.map((p) => p.source))];
  const usedTypes = [...new Set(proposals.map(getItemType))];

  const chip = (active) =>
    `px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all focus-ring ${
      active
        ? "bg-agora-600 text-white shadow-sm shadow-agora-600/20 ring-1 ring-agora-500/40"
        : "bg-gray-100/90 dark:bg-gray-800/90 text-gray-600 dark:text-gray-400 hover:bg-gray-200/90 dark:hover:bg-gray-700/90"
    }`;

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 items-center text-sm">
      {usedTypes.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-400 dark:text-gray-500 mr-0.5 font-medium">Type</span>
          {TYPE_ORDER.filter((t) => usedTypes.includes(t)).map((t) => {
            const meta = TYPE_META[t];
            const active = filterType === t;
            return (
              <button key={t} type="button" onClick={() => onTypeChange(active ? null : t)} className={chip(active)}>
                {meta.label}
              </button>
            );
          })}
        </div>
      )}

      {usedStatuses.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-400 dark:text-gray-500 mr-0.5 font-medium">Status</span>
          {STATUS_ORDER.filter((s) => usedStatuses.includes(s)).map((s) => {
            const meta = STATUS_META[s];
            const active = filterStatus === s;
            return (
              <button key={s} type="button" onClick={() => onStatusChange(active ? null : s)} className={`flex items-center gap-1.5 ${chip(active)}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                {meta.label}
              </button>
            );
          })}
        </div>
      )}

      {usedSources.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-400 dark:text-gray-500 mr-0.5 font-medium">Source</span>
          {usedSources.map((s) => {
            const meta = SOURCE_META[s] || { label: s };
            const active = filterSource === s;
            return (
              <button key={s} type="button" onClick={() => onSourceChange(active ? null : s)} className={chip(active)}>
                {meta.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
