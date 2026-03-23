/**
 * HomeView — project intelligence briefing.
 *
 * Layout:
 *   TOP:   Community sync notes banner (if available)
 *   MAIN:  Left: topics/initiatives  |  Right: recent activity + votes
 */

import { useState, useEffect, useMemo } from "react";
import { fetchInitiatives, fetchEvents, getItemType, relativeTime, SOURCE_META, trendScore } from "../lib/data";
import { cleanTitle } from "../lib/utils";
import DigestBanner from "./DigestBanner";
import InitiativeDetail from "./InitiativeDetail";
import ProposalDetail from "./ProposalDetail";

const DAYS = (n) => n * 86400000;

/** Strip HTML-ish calendar text and decode entities so URLs match reliably. */
function calendarTextBlob(location, description) {
  const raw = `${location || ""} ${description || ""}`;
  const stripped = raw
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>/gi, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped;
}

/** Video calls → Join ↗; other useful URLs → Info ↗ (e.g. summit page, agenda link). */
function extractEventActionLink(location, description) {
  const blob = calendarTextBlob(location, description);
  const meet = blob.match(/https?:\/\/meet\.google\.com\/[\w-]+/i);
  if (meet) return { href: meet[0], label: "Join ↗" };
  const zoom = blob.match(/https?:\/\/[\w.]*zoom\.us\/(?:j\/|join\/|wc\/join\?)[^\s"'<>\]]*/i);
  if (zoom) return { href: zoom[0], label: "Join ↗" };
  const teams = blob.match(/https?:\/\/teams\.(?:microsoft\.com|live\.com)\/[^\s"'<>\]]+/i);
  if (teams) return { href: teams[0], label: "Join ↗" };
  const webex = blob.match(/https?:\/\/[\w.]*\.webex\.com\/[^\s"'<>\]]+/i);
  if (webex) return { href: webex[0], label: "Join ↗" };
  let m = blob.match(/https?:\/\/[^\s"'<>\]]+/);
  if (!m) return null;
  let href = m[0].replace(/[.,;]+$/, "");
  const q = href.match(/[?&]q=([^&]+)/);
  if (q) {
    try {
      const inner = decodeURIComponent(q[1]);
      if (/^https?:\/\//i.test(inner)) href = inner.split("&")[0];
    } catch {
      /* keep href */
    }
  }
  return { href, label: "Details ↗" };
}

// ── Governance stage ──────────────────────────────────────────────────────────
const STAGES = {
  vote_pending:  { label: "Vote",          accent: "border-l-amber-400",  badge: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  in_design:     { label: "In Design",     accent: "border-l-purple-400", badge: "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" },
  active_debate: { label: "Cross-Source",  accent: "border-l-blue-400",   badge: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  active:        { label: "Active",        accent: "border-l-gray-300 dark:border-l-gray-600", badge: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
};

function classifyStage(initiative, members) {
  const hasOpenVote = members.some(m => getItemType(m) === "vote" && (m.state || "open").toLowerCase() === "open" && (!m.vote_data || m.vote_data.result === "open"));
  const sources   = new Set(members.map(m => m.source));
  const hasDocs   = (initiative.shared_docs?.length || 0) > 0;
  if (hasOpenVote)                                          return "vote_pending";
  if ((sources.has("github") || sources.has("mailing_list")) && hasDocs) return "in_design";
  if (sources.has("github") && sources.has("mailing_list")) return "active_debate";
  return "active";
}

function TopicCard({ initiative, members, stage, onSelect, onOpenInitiative }) {
  const stageMeta  = STAGES[stage];
  const sources    = [...new Set(members.map(m => m.source))];
  const hasDocs    = (initiative.shared_docs?.length || 0) > 0;
  const comments   = members.reduce((s, m) => s + (parseInt(m.comment_count) || 0), 0);
  const sorted     = [...members].sort((a, b) => (b.updated_at||"").localeCompare(a.updated_at||""));
  const topItems   = sorted.slice(0, 3);
  const voteItem   = stage === "vote_pending"
    ? members.find(m => getItemType(m) === "vote" && (m.state || "open").toLowerCase() === "open" && (!m.vote_data || m.vote_data.result === "open"))
    : null;

  return (
    <div className={`bg-white/90 dark:bg-gray-900/90 border border-gray-200/90 dark:border-gray-700 border-l-4 ${stageMeta.accent} rounded-2xl overflow-hidden shadow-sm card-interactive`}>
      {/* Header — click to open initiative detail panel */}
      <button type="button" onClick={() => onOpenInitiative?.(initiative)} className="w-full text-left px-3 py-2.5 hover:bg-gray-50/80 dark:hover:bg-gray-800/60 transition-colors focus-ring rounded-t-2xl">
        <div className="flex items-start gap-2 mb-1">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-xs leading-snug flex-1 line-clamp-2">
            {initiative.title}
          </h3>
          <span className={`text-xs px-1 py-0.5 rounded flex-shrink-0 ${stageMeta.badge}`}>{stageMeta.label}</span>
          {voteItem && (
            <a
              href={voteItem.url}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:underline flex-shrink-0"
            >
              Vote ↗
            </a>
          )}
        </div>
        {initiative.summary && (
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 mb-1">{initiative.summary}</p>
        )}
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          {sources.map(s => {
            const srcMeta = SOURCE_META[s] || { label: s, color: "bg-gray-100" };
            return <span key={s} className={`px-1 py-0.5 rounded ${srcMeta.color}`}>{srcMeta.label}</span>;
          })}
          {hasDocs && <span className="text-emerald-600 dark:text-emerald-400">· doc</span>}
          {comments > 0 && <span>· {comments} replies</span>}
          <span className="ml-auto">{relativeTime(initiative.last_activity)}</span>
        </div>
      </button>
      {/* Clickable item rows */}
      {topItems.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-800">
          {topItems.map(p => {
            const srcMeta = SOURCE_META[p.source] || { label: p.source, color: "bg-gray-100 text-gray-600" };
            return (
              <button
                key={p.id}
                onClick={() => onSelect(p)}
                className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs hover:bg-agora-50/60 dark:hover:bg-gray-800/80 transition-colors group border-b border-gray-100/90 dark:border-gray-800 last:border-b-0 focus-ring"
              >
                <span className={`px-1.5 py-0.5 rounded flex-shrink-0 ${srcMeta.color}`}>{srcMeta.label}</span>
                <span className="flex-1 text-gray-700 dark:text-gray-300 truncate group-hover:text-gray-900 dark:group-hover:text-gray-100">
                  {cleanTitle(p)}
                </span>
                <span className="text-gray-300 dark:text-gray-600 group-hover:text-gray-500 flex-shrink-0">→</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Recent activity list item ─────────────────────────────────────────────────
function RecentItem({ p, onSelect }) {
  const type    = getItemType(p);
  const srcMeta = SOURCE_META[p.source] || { label: p.source, color: "bg-gray-100 text-gray-600" };
  const typeAccent = {
    vote: "border-l-amber-400", announcement: "border-l-teal-400",
    proposal: "border-l-yellow-400", pr: "border-l-purple-400",
    discussion: "border-l-blue-300", video: "border-l-red-400",
    doc: "border-l-emerald-400", other: "border-l-gray-200",
  }[type] || "border-l-gray-200";

  return (
    <button
      onClick={() => onSelect(p)}
      className={`w-full text-left flex items-center gap-2 px-3 py-2.5 border-b border-gray-100/90 dark:border-gray-800 last:border-b-0 hover:bg-gray-50/90 dark:hover:bg-gray-800/80 transition-colors group border-l-2 ${typeAccent} focus-ring`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={`text-xs px-1 py-0.5 rounded ${srcMeta.color}`}>{srcMeta.label}</span>
          {p.vote_data && (
            <span className={`text-xs font-semibold ${
              p.vote_data.result === "passed" ? "text-green-600 dark:text-green-400" :
              p.vote_data.result === "vetoed" ? "text-red-600 dark:text-red-400" :
              p.vote_data.result === "cancelled" ? "text-gray-400 dark:text-gray-500" :
              "text-amber-600 dark:text-amber-400"
            }`}>
              {p.vote_data.result === "passed" ? "PASSED" :
               p.vote_data.result === "vetoed" ? "VETOED" :
               p.vote_data.result === "cancelled" ? "CANCELLED" :
               `${p.vote_data.binding_plus1||0}+1`}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-800 dark:text-gray-200 line-clamp-1 group-hover:text-gray-900 dark:group-hover:text-gray-100">
          {cleanTitle(p)}
        </p>
      </div>
      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums">{relativeTime(p.updated_at)}</span>
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function HomeView({ project, proposals, onSelect, onViewActivity }) {
  const [initiatives, setInitiatives]          = useState([]);
  const [initiativesLoading, setInitLoading]   = useState(true);
  const [upcomingEvents, setUpcomingEvents]    = useState([]);
  const [calendarUrl, setCalendarUrl]          = useState([]);
  const [selectedInitiative, setSelectedInitiative] = useState(null);
  const [selectedProposal, setSelectedProposal]     = useState(null);

  useEffect(() => {
    if (!project?.id) return;
    fetchInitiatives(project.id)
      .then(d => setInitiatives(d.initiatives || []))
      .finally(() => setInitLoading(false));
    fetchEvents(project.id)
      .then(d => { setUpcomingEvents(d.events || []); setCalendarUrl(d.calendar_urls || []); });
  }, [project?.id]);

  const proposalsById = useMemo(() => {
    const m = {};
    for (const p of proposals) m[p.id] = p;
    return m;
  }, [proposals]);

  const { votes, recentItems, syncDoc } = useMemo(() => {
    const sorted = [...proposals].sort((a, b) =>
      (b.updated_at || "").localeCompare(a.updated_at || "")
    );

    // Most recent community sync doc
    const doc = proposals.find(p => p.source === "google_doc") || null;

    // Recent votes — newest first, cap at 5
    const recentVotes = proposals
      .filter(p => getItemType(p) === "vote")
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
      .slice(0, 5);

    // Recent items for the sidebar feed (exclude docs, cap at 5)
    const recent = sorted.filter(p => p.source !== "google_doc").slice(0, 5);

    return {
      votes:       recentVotes,
      recentItems: recent,
      syncDoc:     doc,
    };
  }, [proposals]);

  const staged = useMemo(() => {
    const groups = { vote_pending: [], in_design: [], active_debate: [], active: [] };
    for (const initiative of initiatives) {
      const members = (initiative.proposal_ids || []).map(id => proposalsById[id]).filter(Boolean);
      const stage = classifyStage(initiative, members);
      groups[stage].push(initiative);
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => (b.last_activity || "").localeCompare(a.last_activity || ""));
    }
    return groups;
  }, [initiatives, proposalsById]);

  const totalShown  = Object.values(staged).reduce((s, g) => s + g.length, 0);
  const totalHidden = initiatives.length - totalShown;
  const stageOrder  = ["vote_pending", "in_design", "active_debate", "active"];

  return (
    <>
    <div className="space-y-6 fade-in">

      {/* ── TOP: Digest + info strip ── */}
      <div className="space-y-3">
        <DigestBanner projectId={project?.id} compact={false} />

        {/* Community sync + upcoming events side by side */}
        {(syncDoc || upcomingEvents.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {syncDoc && (
              <div className="bg-white/90 dark:bg-gray-900/90 border border-emerald-200/80 dark:border-emerald-800/60 border-l-4 border-l-emerald-500 rounded-2xl px-4 py-4 flex items-start gap-4 shadow-sm hover:shadow-md transition-shadow duration-300">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Community Sync Notes</span>
                    {syncDoc.updated_at && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        · updated {new Date(syncDoc.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    )}
                  </div>
                  {syncDoc.llm_summary ? (
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{syncDoc.llm_summary}</p>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400">{cleanTitle(syncDoc.title)}</p>
                  )}
                </div>
                <a href={syncDoc.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-200 whitespace-nowrap flex-shrink-0 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200/60 dark:border-emerald-800/50 transition-colors focus-ring">
                  Notes ↗
                </a>
              </div>
            )}

            {upcomingEvents.length > 0 && (
              <div className="bg-white/90 dark:bg-gray-900/90 border border-indigo-200/80 dark:border-indigo-800/60 border-l-4 border-l-indigo-400 rounded-2xl px-4 py-4 shadow-sm hover:shadow-md transition-shadow duration-300">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Upcoming Events</span>
                  <div className="flex items-center gap-2">
                    {calendarUrl.map((c, i) => (
                      <a key={i} href={c.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-indigo-600 dark:text-indigo-300 px-2 py-0.5 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors focus-ring" title={c.name}>
                        {c.name.includes("Dev") ? "Dev ↗" : "Community ↗"}
                      </a>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  {upcomingEvents.slice(0, 5).map((ev, i) => {
                    const start = new Date(ev.start);
                    const action = extractEventActionLink(ev.location, ev.description);
                    return (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{ev.title}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">
                            {start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            {" · "}
                            {start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                        {action && (
                          <a href={action.href} target="_blank" rel="noreferrer" className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 flex-shrink-0 px-2 py-0.5 rounded-md bg-indigo-50/90 dark:bg-indigo-900/25 border border-indigo-200/50 dark:border-indigo-800/40 hover:bg-indigo-100/90 dark:hover:bg-indigo-900/40 transition-colors focus-ring">
                            {action.label}
                          </a>
                        )}
                      </div>
                    );
                  })}
                  {upcomingEvents.length > 5 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 pt-0.5">+{upcomingEvents.length - 5} more events</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── MAIN: 2-column layout ── */}
      <div className="flex gap-6 items-start">

        {/* LEFT: Initiatives preview (same data as Initiatives tab, engagement-ranked) */}
        <div className="flex-1 min-w-0">
          <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">Initiatives</h2>

          {initiativesLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {[1,2,3,4].map(i => <div key={i} className="skeleton h-20 rounded-md" />)}
            </div>
          ) : totalShown === 0 ? (
            <div className="border border-dashed border-gray-300/80 dark:border-gray-600 rounded-2xl px-6 py-10 text-center bg-white/40 dark:bg-gray-900/20">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">No initiatives yet</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-2 max-w-xs mx-auto leading-relaxed">
                Run the crawler with LLM enabled to cluster related threads and design docs.
              </p>
            </div>
          ) : (() => {
            // Same data as Initiatives tab, but use engagement score (not stage order) so
            // the home grid stays aligned with what users see as "current" there.
            const all = stageOrder.flatMap(key =>
              staged[key].map((initiative) => ({ initiative, key }))
            );
            all.sort((a, b) =>
              (b.initiative.last_activity || "").localeCompare(a.initiative.last_activity || "")
            );
            const shown = all.slice(0, 8);
            const hiddenCount = all.length - shown.length + totalHidden;
            return (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {shown.map(({ initiative, key }) => {
                    const members = (initiative.proposal_ids || []).map(id => proposalsById[id]).filter(Boolean);
                    return <TopicCard key={initiative.id} initiative={initiative} members={members} stage={key} onSelect={onSelect} onOpenInitiative={setSelectedInitiative} />;
                  })}
                </div>
                {hiddenCount > 0 && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 pl-1">
                    +{hiddenCount} more topics — see Initiatives tab
                  </p>
                )}
              </>
            );
          })()}
        </div>

        {/* RIGHT: Recent activity + votes */}
        <div className="w-64 flex-shrink-0 sticky top-20 self-start space-y-5">

          {/* Recent activity */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Recent</h2>
              <button type="button" onClick={onViewActivity} className="text-xs font-medium text-agora-600 dark:text-agora-400 hover:text-agora-700 dark:hover:text-agora-300 px-2 py-0.5 rounded-md hover:bg-agora-50 dark:hover:bg-agora-900/20 transition-colors focus-ring">
                All activity →
              </button>
            </div>
            <div className="bg-white/90 dark:bg-gray-900/90 border border-gray-200/90 dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm">
              {recentItems.map(p => <RecentItem key={p.id} p={p} onSelect={onSelect} />)}
            </div>
          </div>

          {/* Recent votes */}
          {votes.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">
                Recent Votes
              </h2>
              <div className="bg-white/90 dark:bg-gray-900/90 border border-gray-200/90 dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm">
                {votes.map(p => {
                  const result = p.vote_data?.result;
                  const resultLabel = result === "passed" ? "PASSED" : result === "vetoed" ? "VETOED" : result === "cancelled" ? "DONE" : null;
                  const resultColor = result === "passed" ? "text-green-600 dark:text-green-400" : result === "vetoed" ? "text-red-500 dark:text-red-400" : "text-gray-400 dark:text-gray-500";
                  const accentColor = result === "passed" ? "border-l-green-400" : result === "vetoed" ? "border-l-red-400" : "border-l-amber-400";
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelect(p)}
                      className={`w-full text-left flex items-center gap-2 px-3 py-2.5 hover:bg-amber-50/90 dark:hover:bg-amber-900/15 transition-colors border-b border-gray-100/90 dark:border-gray-800 last:border-b-0 group border-l-2 ${accentColor} focus-ring`}
                    >
                      <span className="flex-1 text-xs text-gray-700 dark:text-gray-300 line-clamp-1 group-hover:text-gray-900 dark:group-hover:text-gray-100">
                        {cleanTitle(p)}
                      </span>
                      {resultLabel ? (
                        <span className={`text-xs font-semibold flex-shrink-0 ${resultColor}`}>{resultLabel}</span>
                      ) : p.vote_data?.binding_plus1 > 0 ? (
                        <span className="text-xs text-green-600 dark:text-green-400 flex-shrink-0 tabular-nums">{p.vote_data.binding_plus1}+1</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>

    {selectedInitiative && (
      <InitiativeDetail
        initiative={selectedInitiative}
        proposalsById={proposalsById}
        onClose={() => setSelectedInitiative(null)}
        onSelectProposal={(p) => { setSelectedInitiative(null); setSelectedProposal(p); }}
      />
    )}

    {selectedProposal && (
      <ProposalDetail
        proposal={selectedProposal}
        onClose={() => setSelectedProposal(null)}
        onSelect={setSelectedProposal}
        allProposals={proposals}
      />
    )}
    </>
  );
}
