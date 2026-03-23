import { useState, useEffect, useMemo } from "react";
import { fetchInitiatives, fetchProposals, STATUS_META, SOURCE_META, relativeTime } from "../lib/data";
import { cleanTitle } from "../lib/utils";
import { GitHubIcon, MailIcon, YouTubeIcon } from "./Icons";
import ProposalDetail from "./ProposalDetail";

// Source icon component
function SourceIcon({ source, className = "w-3 h-3" }) {
  if (source === "github")       return <GitHubIcon className={className} />;
  if (source === "mailing_list") return <MailIcon className={className} />;
  if (source === "youtube")      return <YouTubeIcon className={className} />;
  if (source === "google_doc")   return <span className="text-emerald-600 font-bold text-xs leading-none">↗</span>;
  return null;
}

// Visual "source bridge" — the hero element that makes cross-source value obvious
function SourceBridge({ members, sharedDocs }) {
  const sourceCounts = {};
  for (const m of members) sourceCounts[m.source] = (sourceCounts[m.source] || 0) + 1;
  const sources = Object.entries(sourceCounts);
  const hasDoc = sharedDocs?.length > 0;

  if (sources.length + (hasDoc ? 1 : 0) < 2) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {sources.map(([src, count], i) => {
        const meta = SOURCE_META[src] || { label: src, color: "bg-gray-100 text-gray-600" };
        return (
          <span key={src} className="flex items-center gap-1">
            {i > 0 && <span className="text-gray-300 dark:text-gray-600 text-xs mx-0.5">→</span>}
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${meta.color}`}>
              <SourceIcon source={src} />
              {meta.label}{count > 1 ? ` ×${count}` : ""}
            </span>
          </span>
        );
      })}
      {hasDoc && (
        <span className="flex items-center gap-1">
          <span className="text-gray-300 dark:text-gray-600 text-xs mx-0.5">→</span>
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            <span className="font-bold">↗</span>
            Design Doc{sharedDocs.length > 1 ? ` ×${sharedDocs.length}` : ""}
          </span>
        </span>
      )}
    </div>
  );
}

// Items for one source, shown in the expanded view
function SourceGroup({ source, items, onSelect, sharedDocs }) {
  const meta = SOURCE_META[source] || { label: source, color: "bg-gray-100 text-gray-700" };
  return (
    <div>
      <div className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium mb-2 ${meta.color}`}>
        <SourceIcon source={source} />
        {meta.label} ({items.length})
      </div>
      <div className="space-y-1 ml-1 pl-3 border-l-2 border-gray-100 dark:border-gray-800">
        {items.map((p) => {
          const sm = STATUS_META[p.llm_status || "discussion"] || STATUS_META.discussion;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p)}
              className="w-full text-left flex items-center gap-2 py-1.5 text-xs group"
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sm.dot}`} />
              <span className="flex-1 text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 truncate">
                {cleanTitle(p)}
              </span>
              <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">{relativeTime(p.updated_at)}</span>
            </button>
          );
        })}
        {/* Show shared docs inline under the first source that has them */}
        {source === "github" && sharedDocs?.length > 0 && sharedDocs.map((doc, i) => (
          <a
            key={i}
            href={doc.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 py-1.5 text-xs group"
          >
            <span className="text-emerald-500 flex-shrink-0 font-bold">↗</span>
            <span className="flex-1 text-emerald-700 dark:text-emerald-400 group-hover:text-emerald-800 dark:group-hover:text-emerald-300 truncate">
              {doc.title || "Design Document"}
            </span>
            <span className="text-gray-400 flex-shrink-0 text-xs opacity-0 group-hover:opacity-100">open ↗</span>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function InitiativesView({ project }) {
  const [initiatives, setInitiatives] = useState([]);
  const [proposalsById, setProposalsById] = useState({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchInitiatives(project.id),
      fetchProposals(project.id),
    ]).then(([initData, propData]) => {
      setInitiatives(initData.initiatives || []);
      const byId = {};
      for (const p of propData.proposals || []) byId[p.id] = p;
      setProposalsById(byId);
    }).finally(() => setLoading(false));
  }, [project.id]);

  const sorted = useMemo(() => [...initiatives].sort((a, b) =>
    (b.last_activity || "").localeCompare(a.last_activity || "")
  ), [initiatives]);

  const archivedCount = useMemo(() => sorted.filter(i => i.archived).length, [sorted]);

  const visible = useMemo(() => {
    let list = showArchived ? sorted : sorted.filter(i => !i.archived);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((i) => {
      if (
        i.title?.toLowerCase().includes(q) ||
        i.summary?.toLowerCase().includes(q) ||
        i.key_points?.some((kp) => kp.toLowerCase().includes(q))
      ) {
        return true;
      }
      // Parent title is often LLM-synthesized; match any member thread you saw in Activity
      const members = (i.proposal_ids || []).map((id) => proposalsById[id]).filter(Boolean);
      return members.some((m) => {
        const blob = `${m.title || ""} ${m.llm_title || ""}`.toLowerCase();
        return blob.includes(q);
      });
    });
  }, [sorted, search, showArchived, proposalsById]);

  if (loading) return <div className="text-gray-400 py-12 text-center text-sm">Loading…</div>;

  if (initiatives.length === 0) {
    return (
      <div className="py-16 text-center border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900">
        <p className="text-gray-500 dark:text-gray-400 text-sm">No topics detected yet.</p>
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
          Run the crawler with LLM enabled to discover cross-source clusters.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-5">
        <p className="text-xs text-gray-400">
          {visible.length} topic{visible.length !== 1 ? "s" : ""}
          {!showArchived && archivedCount > 0 && (
            <> — <button type="button" onClick={() => setShowArchived(true)} className="underline hover:text-gray-600 dark:hover:text-gray-300">{archivedCount} archived</button></>
          )}
          {showArchived && archivedCount > 0 && (
            <> · <button type="button" onClick={() => setShowArchived(false)} className="underline hover:text-gray-600 dark:hover:text-gray-300">hide archived</button></>
          )}
        </p>
        {initiatives.length > 5 && (
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search topics or thread titles…"
            className="ml-auto text-xs px-3 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 w-44"
          />
        )}
      </div>

      {visible.length === 0 && search && (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No topics match "{search}"</p>
      )}

      <div className="space-y-2">
        {visible.map((initiative) => {
          const statusMeta = STATUS_META[initiative.status] || STATUS_META.discussion;
          const isExpanded = expanded === initiative.id;
          const members = (initiative.proposal_ids || [])
            .map((id) => proposalsById[id])
            .filter(Boolean);
          const sourceCount = new Set(members.map(m => m.source)).size;
          const isCrossSource = sourceCount > 1 || initiative.shared_docs?.length > 0;

          // Group members by source for the expanded view
          const bySource = {};
          for (const m of members) {
            if (!bySource[m.source]) bySource[m.source] = [];
            bySource[m.source].push(m);
          }

          return (
            <div
              key={initiative.id}
              className={`bg-white/90 dark:bg-gray-900/90 border overflow-hidden transition-all shadow-sm hover:shadow-md rounded-2xl ${initiative.archived ? "opacity-50" : ""} ${
                isCrossSource
                  ? "border-l-4 border-agora-300 dark:border-agora-600 border-r border-t border-b border-gray-200/90 dark:border-gray-700 hover:border-agora-400/80 dark:hover:border-agora-500/80"
                  : "border border-gray-200/90 dark:border-gray-700 hover:border-gray-300/90 dark:hover:border-gray-600"
              }`}
            >
              <button
                type="button"
                className="w-full text-left px-5 py-4 focus-ring rounded-2xl"
                onClick={() => setExpanded(isExpanded ? null : initiative.id)}
              >
                {/* Source bridge — the hero element */}
                {isCrossSource && (
                  <div className="mb-2.5">
                    <SourceBridge members={members} sharedDocs={initiative.shared_docs} />
                  </div>
                )}

                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {initiative.title}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${statusMeta.color}`}>
                        {statusMeta.label}
                      </span>
                    </div>

                    {initiative.summary && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">
                        {initiative.summary}
                      </p>
                    )}

                    {/* Key points when not cross-source (single source initiatives) */}
                    {!isCrossSource && initiative.key_points?.length > 0 && !isExpanded && (
                      <ul className="mt-1.5 space-y-0.5">
                        {initiative.key_points.slice(0, 2).map((pt, i) => (
                          <li key={i} className="text-xs text-gray-500 dark:text-gray-400 flex items-start gap-1.5">
                            <span className="text-agora-400 flex-shrink-0">·</span>{pt}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0 text-xs text-gray-400 dark:text-gray-500">
                    {initiative.proposal_count > 0 && (
                      <span>{initiative.proposal_count} items</span>
                    )}
                    <span>{relativeTime(initiative.last_activity)}</span>
                    <span className="text-gray-300 dark:text-gray-600">{isExpanded ? "↑" : "↓"}</span>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-5 bg-gray-50 dark:bg-gray-950 space-y-5">

                  {/* Cross-source callout */}
                  {isCrossSource && (
                    <div className="rounded-md bg-agora-50 dark:bg-agora-900/20 border border-agora-200 dark:border-agora-800 px-4 py-3">
                      <p className="text-xs font-semibold text-agora-700 dark:text-agora-300 mb-1">
                        Cross-source cluster · {sourceCount} channel{sourceCount !== 1 ? "s" : ""}{initiative.shared_docs?.length > 0 ? " + design doc" : ""}
                      </p>
                      <p className="text-xs text-agora-600 dark:text-agora-400">
                        {initiative.shared_docs?.length > 0
                          ? `These items are linked by a shared design document and are being discussed across ${sourceCount} channel${sourceCount !== 1 ? "s" : ""}.`
                          : `These items are being discussed simultaneously across multiple channels, suggesting coordinated community activity.`
                        }
                      </p>
                    </div>
                  )}

                  {/* Key points */}
                  {initiative.key_points?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Key Points</p>
                      <ul className="space-y-1.5">
                        {initiative.key_points.slice(0, 3).map((pt, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400">
                            <span className="text-agora-500 mt-0.5 flex-shrink-0">·</span>{pt}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Items grouped by source */}
                  <div>
                    <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
                      {isCrossSource ? "Discussions Across Channels" : "Related Items"}
                    </p>
                    <div className="space-y-4">
                      {Object.entries(bySource).map(([src, items]) => (
                        <SourceGroup
                          key={src}
                          source={src}
                          items={items}
                          onSelect={setSelected}
                          sharedDocs={src === Object.keys(bySource)[0] ? initiative.shared_docs : null}
                        />
                      ))}
                      {/* Show shared docs if github isn't in sources */}
                      {!bySource["github"] && initiative.shared_docs?.length > 0 && (
                        <div>
                          <div className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium mb-2 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                            <span className="font-bold">↗</span> Design Docs
                          </div>
                          <div className="space-y-1 ml-1 pl-3 border-l-2 border-gray-100 dark:border-gray-800">
                            {initiative.shared_docs.map((doc, i) => (
                              <a key={i} href={doc.url} target="_blank" rel="noreferrer"
                                className="flex items-center gap-2 py-1.5 text-xs group">
                                <span className="text-emerald-500 flex-shrink-0 font-bold">↗</span>
                                <span className="flex-1 text-emerald-700 dark:text-emerald-400 group-hover:text-emerald-800 truncate">
                                  {doc.title || "Design Document"}
                                </span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selected && (
        <ProposalDetail
          proposal={selected}
          onClose={() => setSelected(null)}
          onSelect={setSelected}
          allProposals={Object.values(proposalsById)}
        />
      )}
    </>
  );
}
