import { useEffect, useMemo } from "react";
import { STATUS_META, SOURCE_META, getItemType, relativeTime } from "../lib/data";
import { cleanTitle } from "../lib/utils";

/** Human-readable labels for `signals` from build_initiatives.py */
function formatSignal(s) {
  if (s.startsWith("topic:")) {
    const t = s.slice(6).replace(/-/g, " ");
    return t ? `Shared topic: ${t}` : s;
  }
  const map = {
    shared_doc: "Shared design document",
    cross_source: "Activity across multiple channels",
    vote_thread: "Vote and discussion linked",
  };
  return map[s] || s;
}

export default function InitiativeDetail({ initiative, proposalsById = {}, onClose, onSelectProposal }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!initiative) return null;

  const members = (initiative.proposal_ids || [])
    .map(id => proposalsById[id])
    .filter(Boolean)
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));

  const statusMeta = STATUS_META[initiative.status] || STATUS_META.discussion;
  const sources = [...new Set(members.map(m => m.source))];
  const activeVote = members.find(
    m => getItemType(m) === "vote" && (!m.vote_data || m.vote_data.result === "open")
  );

  const signalLabels = useMemo(() => {
    const raw = initiative.signals;
    if (!Array.isArray(raw) || raw.length === 0) return [];
    return [...new Set(raw)].map(formatSignal);
  }, [initiative.signals]);

  // Group members by source
  const bySource = {};
  for (const m of members) {
    if (!bySource[m.source]) bySource[m.source] = [];
    bySource[m.source].push(m);
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-gray-900/40 dark:bg-black/50 backdrop-blur-[2px] z-40 transition-opacity"
        onClick={onClose}
        aria-hidden
      />

      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white/95 dark:bg-gray-950/95 backdrop-blur-md border-l border-gray-200/90 dark:border-gray-800 z-50 flex flex-col shadow-2xl shadow-gray-900/10 dark:shadow-black/40 overflow-hidden slide-in-right rounded-l-2xl">

        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-snug">
              {initiative.title}
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className={`text-xs px-2 py-0.5 rounded ${statusMeta.color}`}>
                {statusMeta.label}
              </span>
              {sources.map(s => {
                const srcMeta = SOURCE_META[s] || { label: s, color: "bg-gray-100 text-gray-600" };
                return (
                  <span key={s} className={`text-xs px-2 py-0.5 rounded ${srcMeta.color}`}>
                    {srcMeta.label}
                  </span>
                );
              })}
              {initiative.last_activity && (
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  · {relativeTime(initiative.last_activity)}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 text-lg leading-none transition-colors focus-ring"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">

          {activeVote && (
            <section className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">Open vote</p>
              <a
                href={activeVote.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs px-2.5 py-1 rounded bg-amber-100 dark:bg-amber-800/50 text-amber-800 dark:text-amber-200 hover:underline font-medium flex-shrink-0"
              >
                Open vote ↗
              </a>
            </section>
          )}

          {signalLabels.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                Why grouped
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {signalLabels.map((label, i) => (
                  <li
                    key={`${label}-${i}`}
                    className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                  >
                    {label}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {initiative.summary && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Summary</h3>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{initiative.summary}</p>
            </section>
          )}

          {initiative.key_points?.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Key Points</h3>
              <ul className="space-y-2">
                {initiative.key_points.map((pt, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <span className="text-agora-500 mt-0.5 flex-shrink-0">·</span>
                    {pt}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {initiative.shared_docs?.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Design Documents</h3>
              <div className="space-y-1">
                {initiative.shared_docs.map((doc, i) => (
                  <a
                    key={i}
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-200 group"
                  >
                    <span className="text-emerald-500 flex-shrink-0">↗</span>
                    <span className="truncate">{doc.title || "Design Document"}</span>
                  </a>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
              Discussions ({members.length})
            </h3>
            <div className="space-y-4">
              {Object.entries(bySource).map(([src, items]) => {
                const srcMeta = SOURCE_META[src] || { label: src, color: "bg-gray-100 text-gray-700" };
                return (
                  <div key={src}>
                    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium mb-2 ${srcMeta.color}`}>
                      {srcMeta.label} ({items.length})
                    </span>
                    <div className="space-y-0.5 ml-1 pl-3 border-l-2 border-gray-100 dark:border-gray-800">
                      {items.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => onSelectProposal?.(p)}
                          className="w-full text-left flex items-center gap-2 py-1.5 text-xs group"
                        >
                          <span className="flex-1 text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 truncate">
                            {cleanTitle(p)}
                          </span>
                          <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">{relativeTime(p.updated_at)}</span>
                          <span className="text-gray-300 dark:text-gray-600 group-hover:text-gray-500 flex-shrink-0">→</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

        </div>
      </div>
    </>
  );
}
