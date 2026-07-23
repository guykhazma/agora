import { useEffect, useMemo, useState, useRef, useId } from "react";
import { STATUS_META, SOURCE_META, getStatus, relativeTime, loadFullProposal } from "../lib/data";
import { cleanTitle } from "../lib/utils";
import { useFocusTrap } from "../lib/useFocusTrap";

const LINK_META = {
  google_doc:   { label: "Design Doc",   group: "Design Documents" },
  google_drive: { label: "Drive Folder", group: "Design Documents" },
  github_pr:    { label: "Pull Request", group: "Related Work" },
  github_issue: { label: "Issue",        group: "Related Work" },
  other:        { label: "Link",         group: "Related Work" },
};

const GROUP_ORDER = ["Design Documents", "Related Work"];

export default function ProposalDetail({ proposal: p, projectId, onClose, onSelect, allProposals = [] }) {
  // Index rows omit the heavy `body`; fetch the full text lazily on open.
  const [lazyBody, setLazyBody] = useState(null);
  const panelRef = useRef(null);
  const titleId = useId();
  useFocusTrap(panelRef);
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    setLazyBody(null);
    if (p && projectId && p.body == null) {
      loadFullProposal(projectId, p.id).then((full) => {
        if (alive && full?.body) setLazyBody(full.body);
      });
    }
    return () => { alive = false; };
  }, [p?.id, projectId, p?.body]);

  // LLM-free: find other proposals referencing the same docs. Computed before the
  // early return so the hook order stays stable; guards against a null proposal.
  const relatedByDoc = useMemo(() => {
    const myLinks = p?.linked_resources || [];
    if (!p || !myLinks.length || !allProposals.length) return [];
    const myUrls = new Set(myLinks.map(l => l.url.split("?")[0]));
    return allProposals.filter(other => {
      if (other.id === p.id) return false;
      return (other.linked_resources || []).some(l => myUrls.has(l.url.split("?")[0]));
    }).slice(0, 5);
  }, [p, allProposals]);

  if (!p) return null;

  // Full body when loaded, else the short preview from the index (so the panel
  // always shows something without waiting on the lazy fetch).
  const bodyText = p.body ?? lazyBody ?? p.body_preview ?? "";

  const status     = getStatus(p);
  const statusMeta = STATUS_META[status] || STATUS_META.discussion;
  const sourceMeta = SOURCE_META[p.source] || { label: p.source, color: "bg-gray-100 text-gray-600" };
  const links      = p.linked_resources || [];
  const keyPoints  = p.llm_key_points || [];
  const topics     = p.llm_topics || [];
  const isStale    = _isStale(p.updated_at);

  return (
    <>
      <div className="fixed inset-0 bg-gray-900/40 dark:bg-black/50 backdrop-blur-[2px] z-40 transition-opacity" onClick={onClose} aria-hidden />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-white/95 dark:bg-gray-950/95 backdrop-blur-md border-l border-gray-200/90 dark:border-gray-800 z-50 flex flex-col shadow-2xl shadow-gray-900/10 dark:shadow-black/40 overflow-hidden slide-in-right rounded-l-2xl focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex-1 min-w-0">
            <a
              id={titleId}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="text-base font-semibold text-gray-900 dark:text-gray-100 hover:text-agora-600 leading-snug block"
            >
              {cleanTitle(p)}
            </a>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className={`text-xs px-2 py-0.5 rounded ${statusMeta.color}`}>
                {statusMeta.label}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded ${sourceMeta.color}`}>
                {sourceMeta.label}
              </span>
              {isStale && (
                <span className="text-xs px-2 py-0.5 rounded bg-orange-50 text-orange-600">
                  Stale
                </span>
              )}
              {topics.map((t) => (
                <span key={t} className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  {t}
                </span>
              ))}
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

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            {p.author && <span>By <span className="text-gray-800 dark:text-gray-200">{p.author.replace(/\s*<.*>/, "")}</span></span>}
            {p.created_at && <span>Opened {relativeTime(p.created_at)}</span>}
            {p.updated_at && <span>Updated {relativeTime(p.updated_at)}</span>}
            {(Number(p.comment_count) || 0) > 0 && <span>{p.comment_count} replies</span>}
          </div>

          {/* Cross-source callout — shown first if this item has related discussions elsewhere */}
          {relatedByDoc.length > 0 && (
            <section className="rounded-md bg-agora-50 dark:bg-agora-900/20 border border-agora-200 dark:border-agora-800 px-4 py-3">
              <h3 className="text-xs font-semibold text-agora-700 dark:text-agora-300 mb-2 flex items-center gap-1.5">
                <span>↔</span> Also active in {relatedByDoc.length} other channel{relatedByDoc.length !== 1 ? "s" : ""}
              </h3>
              <div className="space-y-1">
                {relatedByDoc.map(other => {
                  const srcMeta = SOURCE_META[other.source] || { label: other.source, color: "bg-gray-100 text-gray-600" };
                  return (
                    <button
                      type="button"
                      key={other.id}
                      onClick={() => onSelect?.(other)}
                      className="w-full flex items-center gap-2 text-xs text-left group"
                      aria-label={`Open related thread: ${cleanTitle(other.title)}`}
                    >
                      <span className={`px-1.5 py-0.5 rounded flex-shrink-0 ${srcMeta.color}`}>{srcMeta.label}</span>
                      <span className="flex-1 text-agora-700 dark:text-agora-300 group-hover:text-agora-900 dark:group-hover:text-agora-100 truncate">
                        {cleanTitle(other.title)}
                      </span>
                      <span className="text-agora-400 flex-shrink-0">→</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Vote tally — shown for vote threads */}
          {p.vote_data && (
            <VoteTally vote={p.vote_data} />
          )}

          {/* Milestone progress bar */}
          {p.milestone_progress && p.milestone_progress.total > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Progress</h3>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-2">
                  <div
                    className="bg-violet-500 h-2 rounded-full transition-all"
                    style={{ width: `${p.milestone_progress.pct}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums flex-shrink-0">
                  {p.milestone_progress.closed}/{p.milestone_progress.total} issues
                </span>
              </div>
              {p.due_on && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Due {new Date(p.due_on).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </p>
              )}
            </section>
          )}

          {p.llm_summary && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Summary</h3>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{p.llm_summary}</p>
            </section>
          )}

          {keyPoints.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Key Points</h3>
              <ul className="space-y-2">
                {keyPoints.map((pt, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <span className="text-agora-500 mt-0.5 flex-shrink-0">·</span>
                    {pt}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {links.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                Linked Resources
              </h3>
              {GROUP_ORDER.map((group) => {
                const groupLinks = links.filter(
                  (l) => (LINK_META[l.kind] || LINK_META.other).group === group
                );
                if (groupLinks.length === 0) return null;
                return (
                  <div key={group} className="mb-3">
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{group}</p>
                    <div className="space-y-1.5">
                      {groupLinks.map((l, i) => {
                        const meta = LINK_META[l.kind] || LINK_META.other;
                        return (
                          <a
                            key={i}
                            href={l.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 rounded text-sm transition-colors group"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-800 dark:text-gray-200 group-hover:text-gray-900 dark:group-hover:text-gray-100">
                                  {l.title || meta.label}
                                </span>
                                {l.fetched && (
                                  <span className="text-xs text-green-600">· summarized</span>
                                )}
                              </div>
                              <div className="text-gray-400 dark:text-gray-500 text-xs truncate mt-0.5">{l.url}</div>
                            </div>
                            <span className="text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-400 flex-shrink-0 text-xs">↗</span>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {bodyText && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                Original
              </h3>
              <pre className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap leading-relaxed bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-3 max-h-48 overflow-y-auto">
                {bodyText}
              </pre>
            </section>
          )}

          {p.labels?.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Labels</h3>
              <div className="flex flex-wrap gap-1.5">
                {p.labels.map((l) => (
                  <span key={l} className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                    {l}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950">
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="block w-full text-center px-4 py-2 bg-gray-900 dark:bg-gray-100 hover:bg-gray-800 dark:hover:bg-white rounded text-sm text-white dark:text-gray-900 font-medium transition-colors"
          >
            Open in {p.source === "youtube" ? "YouTube" : p.source === "mailing_list" ? "Mailing List" : "GitHub"} ↗
          </a>
        </div>
      </div>
    </>
  );
}

function _isStale(updatedAt) {
  if (!updatedAt) return false;
  return (Date.now() - new Date(updatedAt).getTime()) / 86400000 > 90;
}

function VoteCloses({ closesAt }) {
  const ms = new Date(closesAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  const closed = ms <= 0;
  const hours = Math.round(ms / 3600000);
  const soon = !closed && hours <= 24;
  const label = closed
    ? "voting window has passed"
    : hours < 48
    ? `closes in ~${hours}h`
    : `closes in ~${Math.round(hours / 24)}d`;
  return (
    <p className={`text-xs mb-2 ${soon ? "font-semibold" : "opacity-80"}`}>
      ⏳ {label} <span className="opacity-70">(approx, from the vote window)</span>
    </p>
  );
}

function VoteTally({ vote }) {
  const result = vote.result || "open";
  const resultColor = result === "passed"
    ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800"
    : result === "vetoed"
    ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800"
    : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800";

  return (
    <section className={`rounded-md border px-4 py-3 ${resultColor}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wider mb-2">Vote Tally</h3>
      <div className="flex items-center gap-4 text-sm font-medium mb-2">
        {vote.binding_plus1 > 0 && (
          <span className="text-green-700 dark:text-green-300">+1 binding: {vote.binding_plus1}</span>
        )}
        {vote.nonbinding_plus1 > 0 && (
          <span className="text-green-600 dark:text-green-400">+1 non-binding: {vote.nonbinding_plus1}</span>
        )}
        {vote.vetoes > 0 && (
          <span className="text-red-700 dark:text-red-300">-1 vetoes: {vote.vetoes}</span>
        )}
        <span className="ml-auto text-xs font-semibold uppercase">
          {result === "passed" ? "PASSED" : result === "vetoed" ? "VETOED" : "IN PROGRESS"}
        </span>
      </div>
      {result === "open" && vote.closes_at && <VoteCloses closesAt={vote.closes_at} />}
      {vote.voters?.length > 0 && (
        <div className="text-xs opacity-75 space-y-0.5">
          {vote.voters.slice(0, 5).map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={v.vote.startsWith("+1") ? "text-green-600" : "text-red-600"}>{v.vote}</span>
              <span>{v.voter.replace(/\s*<.*>/, "")}</span>
            </div>
          ))}
          {vote.voters.length > 5 && (
            <div className="opacity-60">+{vote.voters.length - 5} more votes</div>
          )}
        </div>
      )}
    </section>
  );
}
