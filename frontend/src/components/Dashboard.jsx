import { useState, useEffect, useMemo } from "react";
import { fetchProjectIndex, getStatus, getItemType, relativeTime, fetchInitiatives, projectLandingUrl, matchesGlobalSearch } from "../lib/data";
import HomeView from "./HomeView";
import TypeGroupedView from "./TypeGroupedView";
import DocsView from "./DocsView";
import EventsView from "./EventsView";
import SearchBar from "./SearchBar";
import FilterBar from "./FilterBar";
import ActivityFeed from "./ActivityFeed";
import KanbanBoard from "./KanbanBoard";
import ProposalDetail from "./ProposalDetail";
import InitiativesView from "./InitiativesView";
import { useProposalKeyboard } from "../lib/useKeyboard";
import { useWatchlist } from "../lib/prefs";
import { useHashRoute } from "../lib/useHashRoute";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { GlobeIcon, GitHubIcon, MailIcon, YouTubeIcon, SlackIcon } from "./Icons";

const VIEWS = ["home", "topics", "activity", "docs", "events"];

export default function Dashboard({ project }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [initiativesCount, setInitiativesCount] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 200);
  const [filterStatus, setFilterStatus] = useState(null);
  const [filterSource, setFilterSource] = useState(null);
  const [filterType, setFilterType] = useState(null);
  const [activityLayout, setActivityLayout] = useState("grouped"); // "grouped" | "kanban"
  const [starredOnly, setStarredOnly] = useState(false);
  const { ids: watchIds, count: watchCount } = useWatchlist();

  // Route is the single source of truth for the active tab + open detail.
  const [route, setRoute] = useHashRoute();
  const view = VIEWS.includes(route.tab) ? route.tab : "home";
  const setView = (v) => setRoute({ tab: v, item: null, init: null });

  useEffect(() => {
    setLoading(true);
    setError(null);
    setInitiativesCount(null);
    fetchProjectIndex(project.id)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    fetchInitiatives(project.id).then(d => setInitiativesCount(d.total ?? (d.initiatives?.length || 0)));
  }, [project.id]);

  const proposals = data?.proposals || [];

  // Open proposal detail is driven by the hash (?item=). Resolve id → row.
  const openProposal = (p) => setRoute({ item: p?.id || null });
  const closeProposal = () => setRoute({ item: null });
  const selected = route.item ? proposals.find((p) => p.id === route.item) || null : null;

  // Build set of initiative IDs that span multiple sources (for cross-source badges)
  const crossSourceInitIds = useMemo(() => {
    const sourcesPerInit = {};
    for (const p of proposals) {
      if (p.initiative_id) {
        if (!sourcesPerInit[p.initiative_id]) sourcesPerInit[p.initiative_id] = new Set();
        sourcesPerInit[p.initiative_id].add(p.source);
      }
    }
    return new Set(
      Object.entries(sourcesPerInit)
        .filter(([, sources]) => sources.size > 1)
        .map(([id]) => id)
    );
  }, [proposals]);

  const filtered = useMemo(() => {
    let result = proposals;
    if (search.trim()) {
      result = result.filter((p) => matchesGlobalSearch(p, search));
    }
    if (filterType) result = result.filter((p) => getItemType(p) === filterType);
    if (filterStatus) result = result.filter((p) => getStatus(p) === filterStatus);
    if (filterSource) result = result.filter((p) => p.source === filterSource);
    if (starredOnly) result = result.filter((p) => watchIds.has(p.id));
    return result;
  }, [proposals, search, filterStatus, filterSource, filterType, starredOnly, watchIds]);

  const scrollToSearchResults = () => {
    document.getElementById("global-search-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useProposalKeyboard({
    proposals: filtered,
    selected,
    onSelect: openProposal,
    onClose: closeProposal,
  });

  if (loading) return (
    <div className="space-y-4 mt-4 fade-in">
      <div className="skeleton h-20 w-full rounded-xl" />
      <div className="skeleton h-16 w-3/4 max-w-lg rounded-xl" />
      <div className="skeleton h-20 w-full rounded-xl" />
      <div className="skeleton h-12 w-full max-w-md rounded-lg" />
    </div>
  );
  if (error)   return <div className="text-red-500 py-16 text-center text-sm">{error}</div>;

  const showFilters = view === "activity";
  const filtersActive = !!(search.trim() || filterStatus || filterSource || filterType || starredOnly);

  function clearFilters() {
    setSearchInput("");
    setFilterStatus(null);
    setFilterSource(null);
    setFilterType(null);
    setStarredOnly(false);
  }

  return (
    <>
      {/* Sticky project header + tab bar — sits just below the global Header (h-14 = top-14) */}
      <div className="sticky top-14 z-20 -mx-6 px-6 mb-6 bg-white/90 dark:bg-gray-950/90 backdrop-blur-md border-b border-gray-200/80 dark:border-gray-800 shadow-sm fade-in">
        {/* Project name, description, quick links */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 pb-2">
          <div className="flex items-center gap-3 min-w-0">
            {project.logo && (
              <a
                href={projectLandingUrl(project)}
                target="_blank"
                rel="noreferrer"
                className="flex-shrink-0 focus-ring rounded-lg"
                aria-label={`${project.name} — project site`}
              >
                <img
                  src={project.logo}
                  alt=""
                  className="h-7 w-auto max-h-7 max-w-[100px] object-contain rounded-md bg-white px-1 py-0.5"
                  onError={(e) => { e.target.closest("a")?.classList.add("hidden"); }}
                />
              </a>
            )}
            <div className="min-w-0">
              <button
                onClick={() => setView("home")}
                className="text-base font-semibold text-gray-900 dark:text-white hover:text-agora-600 dark:hover:text-agora-400 transition-colors text-left leading-tight"
              >
                {project.name}
              </button>
              {project.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs">{project.description}</p>
              )}
            </div>
          </div>

          {/* Quick links */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
            {project.website && (
              <a href={project.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-200 transition-colors">
                <GlobeIcon className="w-3 h-3" /> Website
              </a>
            )}
            {project.repo && (
              <a href={`https://github.com/${project.repo}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-200 transition-colors">
                <GitHubIcon className="w-3 h-3" /> GitHub
              </a>
            )}
            {project.mailing_list_url && (
              <a href={project.mailing_list_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-200 transition-colors">
                <MailIcon className="w-3 h-3" /> Mailing List
              </a>
            )}
            {project.youtube_url && (
              <a href={project.youtube_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-red-600 transition-colors">
                <YouTubeIcon className="w-3 h-3" /> YouTube
              </a>
            )}
            {project.slack_url && (
              <a href={project.slack_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-purple-600 transition-colors">
                <SlackIcon className="w-3 h-3" /> {project.slack_channel || "Slack"}
              </a>
            )}
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex flex-wrap items-center gap-3 pb-2">
          <div
            className="inline-flex flex-wrap p-1 rounded-xl bg-gray-100/90 dark:bg-gray-800/80 border border-gray-200/60 dark:border-gray-700/80 shadow-inner gap-0.5"
            role="tablist"
          >
            {VIEWS.map((v) => {
              const label = v === "home" ? "Overview" : v === "topics" ? "Initiatives" : v === "activity" ? "Feed" : v === "docs" ? "Docs" : "Events";
              const count = v === "topics" ? initiativesCount : null;
              return (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={`px-3.5 py-1.5 text-sm rounded-lg transition-all flex items-center gap-1.5 focus-ring ${
                    view === v
                      ? "text-gray-900 dark:text-white font-semibold bg-white dark:bg-gray-900 shadow-sm ring-1 ring-gray-200/80 dark:ring-gray-600"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                  }`}
                >
                  {label}
                  {count != null && count > 0 && (
                    <span
                      className={`text-xs tabular-nums px-1.5 py-0.5 rounded-md ${
                        view === v
                          ? "bg-agora-100 dark:bg-agora-900/50 text-agora-800 dark:text-agora-200"
                          : "bg-gray-200/70 dark:bg-gray-700/60 text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {project.last_updated && (
            <span className="text-xs text-gray-400 dark:text-gray-500 sm:ml-auto">
              Updated {relativeTime(project.last_updated)}
            </span>
          )}
        </div>

        {/* Global search — same corpus as Feed (GitHub, ML, video, docs, votes…) */}
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <SearchBar
            id="global-search"
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Search all sources — GitHub, mailing list, video, docs, links…"
            onSubmit={scrollToSearchResults}
          />
          <button
            type="button"
            onClick={() => {
              document.getElementById("global-search")?.focus({ preventScroll: true });
              scrollToSearchResults();
            }}
            className="shrink-0 px-4 py-2 text-sm font-medium rounded-xl bg-agora-600 hover:bg-agora-700 text-white dark:bg-agora-500 dark:hover:bg-agora-600 shadow-sm focus:outline-none focus:ring-2 focus:ring-agora-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950 transition-colors"
          >
            Search
          </button>
          {search.trim() && view !== "topics" && (
            <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
              {filtered.length} match{filtered.length !== 1 ? "es" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Filters for browse/list views */}
      {showFilters && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <FilterBar
            proposals={proposals}
            filterStatus={filterStatus}
            filterSource={filterSource}
            filterType={filterType}
            onStatusChange={setFilterStatus}
            onSourceChange={setFilterSource}
            onTypeChange={setFilterType}
          />
          <button
            type="button"
            onClick={() => setStarredOnly((v) => !v)}
            aria-pressed={starredOnly}
            title={watchCount ? `${watchCount} starred item${watchCount !== 1 ? "s" : ""}` : "Star items to build a watchlist"}
            className={`text-xs px-3 py-1.5 rounded-xl font-medium border transition-colors focus-ring flex items-center gap-1.5 ${
              starredOnly
                ? "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300"
                : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-amber-300 dark:hover:border-amber-700"
            }`}
          >
            <span className={starredOnly ? "text-amber-400" : "text-gray-400"}>★</span>
            Starred
            {watchCount > 0 && <span className="tabular-nums opacity-80">{watchCount}</span>}
          </button>
          <div className="flex items-center gap-0.5 p-1 rounded-xl bg-gray-100/90 dark:bg-gray-800/90 border border-gray-200/60 dark:border-gray-700/80 shadow-inner ml-auto">
            {[["grouped", "List"], ["kanban", "Board"]].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActivityLayout(key)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all focus-ring ${
                  activityLayout === key
                    ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-gray-200/80 dark:ring-gray-600"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="w-full flex flex-wrap items-center gap-2 justify-between">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {filtered.length} item{filtered.length !== 1 ? "s" : ""}
              {filtered.length !== proposals.length && ` of ${proposals.length}`}
            </p>
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-medium text-agora-600 dark:text-agora-400 hover:text-agora-700 dark:hover:text-agora-300 px-2 py-1 rounded-lg hover:bg-agora-50 dark:hover:bg-agora-900/20 transition-colors focus-ring"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      {view === "home" && search.trim() ? (
        <div id="global-search-results" className="scroll-mt-36 mb-8 space-y-3 fade-in">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Matching items · {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </h2>
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
              No proposals match “{search.trim()}”. Try other keywords or check linked URLs in the thread body.
            </p>
          ) : (
            <TypeGroupedView proposals={filtered} onSelect={openProposal} crossSourceInitIds={crossSourceInitIds} />
          )}
        </div>
      ) : null}

      {view === "home" ? (
        <HomeView
          project={project}
          proposals={proposals}
          onSelect={openProposal}
          onViewActivity={() => setView("activity")}
          onViewEvents={() => setView("events")}
        />
      ) : view === "topics" ? (
        <InitiativesView project={project} searchQuery={search} onSelect={openProposal} />
      ) : view === "events" ? (
        <EventsView projectId={project.id} />
      ) : view === "docs" ? (
        <DocsView proposals={filtered} onSelect={openProposal} />
      ) : (
        /* activity — all items with filters + sidebar feed */
        activityLayout === "kanban" ? (
          <KanbanBoard proposals={filtered} onSelect={openProposal} />
        ) : (
          <div className="flex flex-col lg:flex-row gap-8 items-start">
            <div className="flex-1 min-w-0">
              <TypeGroupedView proposals={filtered} onSelect={openProposal} crossSourceInitIds={crossSourceInitIds} />
            </div>
            {proposals.length > 0 && (
              <div className="w-full lg:w-auto">
                <ActivityFeed proposals={proposals} onSelect={openProposal} crossSourceInitIds={crossSourceInitIds} />
              </div>
            )}
          </div>
        )
      )}

      {selected && (
        <ProposalDetail proposal={selected} projectId={project.id} onClose={closeProposal} onSelect={openProposal} allProposals={proposals} />
      )}
    </>
  );
}
