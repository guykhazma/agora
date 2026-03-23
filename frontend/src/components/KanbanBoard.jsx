import { STATUS_ORDER, STATUS_META, getStatus } from "../lib/data";
import ProposalCard from "./ProposalCard";

const VISIBLE_STATUSES = STATUS_ORDER.filter((s) => s !== "abandoned");

export default function KanbanBoard({ proposals, onSelect }) {
  const byStatus = {};
  for (const p of proposals) {
    const s = getStatus(p);
    if (!byStatus[s]) byStatus[s] = [];
    byStatus[s].push(p);
  }

  const columns = [
    ...VISIBLE_STATUSES,
    ...((byStatus["abandoned"] || []).length > 0 ? ["abandoned"] : []),
  ];

  return (
    <div className="overflow-x-auto pb-4 -mx-1 px-1 fade-in">
      <div className="flex gap-4 min-w-max">
        {columns.map((status) => {
          const items = byStatus[status] || [];
          const meta = STATUS_META[status];
          return (
            <div key={status} className="w-72 flex-shrink-0 flex flex-col">
              <div
                className={`flex items-center gap-2 px-3 py-2.5 rounded-t-xl border border-b-0 ${meta.color} border-gray-200/80 dark:border-gray-700`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{meta.label}</span>
                <span className="ml-auto text-xs tabular-nums font-medium text-gray-500 dark:text-gray-400 bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded-md">
                  {items.length}
                </span>
              </div>
              <div className="flex-1 bg-gray-50/90 dark:bg-gray-900/80 rounded-b-xl border border-gray-200/90 dark:border-gray-800 border-t-0 min-h-[220px] p-2 flex flex-col gap-2 shadow-inner">
                {items.length === 0 && (
                  <p className="text-xs text-gray-400 dark:text-gray-600 text-center pt-8 px-2 leading-relaxed">Nothing in this column with the current filters.</p>
                )}
                {items.map((p) => (
                  <ProposalCard key={p.id} proposal={p} compact onClick={() => onSelect(p)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
