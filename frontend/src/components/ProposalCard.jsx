import { STATUS_META, SOURCE_META, TYPE_META, getStatus, getItemType, relativeTime, isHot } from "../lib/data";
import { cleanTitle } from "../lib/utils";
import { useWatchlist } from "../lib/prefs";
import StarButton from "./StarButton";

const TYPE_BORDER = {
  vote:         "border-l-amber-400",
  announcement: "border-l-teal-400",
  proposal:     "border-l-yellow-400",
  pr:           "border-l-purple-400",
  video:        "border-l-red-400",
  discussion:   "border-l-blue-400",
  milestone:    "border-l-violet-400",
  release:      "border-l-emerald-400",
  doc:          "border-l-emerald-500",
  other:        "border-l-gray-300",
};

export default function ProposalCard({ proposal: p, compact = false, onClick, crossSourceInitIds }) {
  const status     = getStatus(p);
  const type       = getItemType(p);
  const statusMeta = STATUS_META[status] || STATUS_META.discussion;
  const sourceMeta = SOURCE_META[p.source] || { label: p.source, color: "bg-gray-100 text-gray-600" };
  const borderClass = TYPE_BORDER[type] || "border-l-gray-300";
  const hot        = isHot(p);
  const { has, toggle } = useWatchlist();
  const starred    = has(p.id);

  const docs = (p.linked_resources || []).filter(l => l.kind === "google_doc" || l.kind === "google_drive");

  if (compact) {
    return (
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
        className={`bg-white/90 dark:bg-gray-900/90 border border-gray-200/90 dark:border-gray-700 border-l-4 ${borderClass} rounded-xl px-3 py-2.5
          card-interactive cursor-pointer focus-ring shadow-sm`}
        onClick={onClick}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusMeta.dot} ${hot ? "dot-pulse" : ""}`} />
          <p className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate flex-1">
            {cleanTitle(p)}
          </p>
          <StarButton id={p.id} starred={starred} toggle={toggle} className="text-xs" />
          <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">{relativeTime(p.updated_at)}</span>
        </div>
        <div className="flex items-center gap-2 mt-1 pl-3.5">
          <span className={`text-xs px-1 py-0.5 rounded ${sourceMeta.color}`}>{sourceMeta.label}</span>
          {p.vote_data && (
            <span className={`text-xs px-1 py-0.5 rounded font-medium ${
              p.vote_data.result === "passed" ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300" :
              p.vote_data.result === "vetoed" ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300" :
              p.vote_data.result === "cancelled" ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" :
              "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            }`}>
              {p.vote_data.result === "passed" ? `PASSED (${p.vote_data.binding_plus1}+1)` :
               p.vote_data.result === "vetoed" ? "VETOED" :
               p.vote_data.result === "cancelled" ? "CANCELLED" :
               `${p.vote_data.binding_plus1 || 0}+1`}
            </span>
          )}
          {docs.length > 0 && <span className="text-xs text-emerald-600 dark:text-emerald-500">{docs.length} doc{docs.length > 1 ? "s" : ""}</span>}
          {(parseInt(p.comment_count) || 0) > 0 && <span className="text-xs text-gray-400 dark:text-gray-500">{p.comment_count} replies</span>}
          {crossSourceInitIds?.has(p.initiative_id) && (
            <span className="text-xs px-1 py-0.5 rounded bg-agora-50 dark:bg-agora-900/30 text-agora-700 dark:text-agora-300">
              multi-channel
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
      className={`bg-white/90 dark:bg-gray-900/90 border border-gray-200/90 dark:border-gray-700 border-l-4 ${borderClass} rounded-xl px-4 py-3.5
        card-interactive cursor-pointer focus-ring shadow-sm`}
      onClick={onClick}
    >
      <div className="flex items-start gap-2.5">
        <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${statusMeta.dot} ${hot ? "dot-pulse" : ""}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-snug line-clamp-2 flex-1">
              {cleanTitle(p)}
            </p>
            <StarButton id={p.id} starred={starred} toggle={toggle} className="text-sm mt-0.5" />
          </div>
          {p.llm_summary && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed line-clamp-2">
              {p.llm_summary}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className={`text-xs px-1.5 py-0.5 rounded ${sourceMeta.color}`}>
              {sourceMeta.label}
            </span>
            {p.vote_data && (
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                p.vote_data.result === "passed" ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300" :
                p.vote_data.result === "vetoed" ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300" :
                p.vote_data.result === "cancelled" ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" :
                "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
              }`}>
                {p.vote_data.result === "passed" ? `PASSED (${p.vote_data.binding_plus1}+1)` :
                 p.vote_data.result === "vetoed" ? "VETOED" :
                 p.vote_data.result === "cancelled" ? "CANCELLED" :
                 `${p.vote_data.binding_plus1 || 0}+1 so far`}
              </span>
            )}
            {docs.length > 0 && (
              <span className="text-xs text-emerald-600 dark:text-emerald-500">
                {docs.length} doc{docs.length > 1 ? "s" : ""}
              </span>
            )}
            {(parseInt(p.comment_count) || 0) > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {p.comment_count} replies
              </span>
            )}
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{relativeTime(p.updated_at)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
