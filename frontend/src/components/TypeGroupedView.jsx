import { useState } from "react";
import { TYPE_ORDER, TYPE_META, getItemType } from "../lib/data";
import ProposalCard from "./ProposalCard";

// How many items to show before "Show more" per type
const PAGE_SIZE = { vote: 6, discussion: 12, announcement: 6, doc: 6, other: 6, default: 50 };
// Start collapsed for high-volume, low-signal sections
const DEFAULT_COLLAPSED = new Set(["announcement", "other"]);

export default function TypeGroupedView({ proposals, onSelect, crossSourceInitIds }) {
  const [collapsed, setCollapsed] = useState(() =>
    Object.fromEntries(TYPE_ORDER.map((t) => [t, DEFAULT_COLLAPSED.has(t)]))
  );
  const [expanded, setExpanded] = useState({}); // type → bool (show all)

  const byType = {};
  for (const p of proposals) {
    const t = getItemType(p);
    if (!byType[t]) byType[t] = [];
    byType[t].push(p);
  }

  const types = TYPE_ORDER.filter((t) => byType[t]?.length > 0);

  if (types.length === 0) {
    return <p className="text-gray-500 text-sm py-8 text-center">No items match your filters.</p>;
  }

  function toggle(type) {
    setCollapsed((c) => ({ ...c, [type]: !c[type] }));
  }

  return (
    <div className="flex flex-col gap-3">
      {types.map((type) => {
        const items = byType[type];
        const meta = TYPE_META[type];
        const open = !collapsed[type];
        const limit = PAGE_SIZE[type] ?? PAGE_SIZE.default;
        const showAll = expanded[type];
        const visible = showAll ? items : items.slice(0, limit);
        const hiddenCount = items.length - visible.length;

        return (
          <div key={type} className="rounded-2xl border border-gray-200/90 dark:border-gray-700 overflow-hidden shadow-sm">
            <button
              type="button"
              className="w-full flex items-center gap-2 px-4 py-3.5 text-left bg-white/90 dark:bg-gray-900/90 hover:bg-gray-50/90 dark:hover:bg-gray-800/80 transition-colors focus-ring"
              onClick={() => toggle(type)}
            >
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${meta.dot}`} />
              <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">{meta.label}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${meta.color} ml-1`}>{items.length}</span>
              <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{open ? "↑" : "↓"}</span>
            </button>

            {open && (
              <div className="border-t border-gray-100/90 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-950/50 p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                  {visible.map((p) => (
                    <ProposalCard key={p.id} proposal={p} compact onClick={() => onSelect(p)} crossSourceInitIds={crossSourceInitIds} />
                  ))}
                </div>
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpanded((e) => ({ ...e, [type]: true }))}
                    className="mt-3 w-full text-xs font-medium text-center text-agora-600 dark:text-agora-400 hover:text-agora-700 dark:hover:text-agora-300 py-2.5 border-t border-gray-100/90 dark:border-gray-800 rounded-b-xl transition-colors focus-ring"
                  >
                    Show {hiddenCount} more {meta.label.toLowerCase()}s
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
