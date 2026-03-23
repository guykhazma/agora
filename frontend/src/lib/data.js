/**
 * Data fetching utilities.
 * All data lives in /data/ (static JSON files).
 */

const BASE = import.meta.env.VITE_BASE_PATH?.replace(/\/$/, "") || "";

async function fetchJSON(path) {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.json();
}

export async function fetchProjects() {
  const data = await fetchJSON("/data/projects.json");
  return data.projects || [];
}

export async function fetchProposals(projectId) {
  const data = await fetchJSON(`/data/${projectId}/proposals.json`);
  return data;
}

export async function fetchInitiatives(projectId) {
  try {
    const data = await fetchJSON(`/data/${projectId}/initiatives.json`);
    return data;
  } catch {
    return { initiatives: [], total: 0 };
  }
}

export async function fetchEvents(projectId) {
  try {
    const data = await fetchJSON(`/data/${projectId}/events.json`);
    return data;
  } catch {
    return { events: [], calendar_urls: [] };
  }
}

/** Where the project logo / name should link (site, or GitHub if no site). */
export function projectLandingUrl(project) {
  if (!project) return "#";
  if (project.website) return project.website;
  if (project.repo) return `https://github.com/${project.repo}`;
  return "#";
}

export const STATUS_ORDER = [
  "idea",
  "discussion",
  "proposal",
  "implementation",
  "released",
  "abandoned",
];

export const STATUS_META = {
  idea:           { label: "Idea",           color: "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",  dot: "bg-purple-400" },
  discussion:     { label: "Discussion",     color: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",          dot: "bg-blue-400" },
  proposal:       { label: "Proposal",       color: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",      dot: "bg-amber-400" },
  implementation: { label: "Implementation", color: "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",  dot: "bg-orange-400" },
  released:       { label: "Released",       color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300",      dot: "bg-green-400" },
  abandoned:      { label: "Abandoned",      color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",            dot: "bg-gray-400" },
};

export const SOURCE_META = {
  github:       { label: "GitHub",       color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  mailing_list: { label: "Mailing List", color: "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" },
  youtube:      { label: "Video",        color: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
  google_doc:   { label: "Sync Notes",   color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
};

export function getStatus(proposal) {
  return proposal.llm_status || "discussion";
}

// Votes/announcements first — they're actionable/informational; discussions are exploratory
export const TYPE_ORDER = ["vote", "proposal", "milestone", "release", "pr", "discussion", "announcement", "video", "doc", "other"];

export const TYPE_META = {
  vote:         { label: "Vote",         color: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",    dot: "bg-amber-400" },
  proposal:     { label: "RFC/Spec",     color: "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300", dot: "bg-yellow-400" },
  milestone:    { label: "Milestone",    color: "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", dot: "bg-violet-400" },
  release:      { label: "Release",      color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300",    dot: "bg-green-400" },
  pr:           { label: "Pull Request", color: "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300", dot: "bg-purple-400" },
  discussion:   { label: "Discussion",   color: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",        dot: "bg-blue-400" },
  announcement: { label: "Announcement", color: "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",       dot: "bg-teal-400" },
  video:        { label: "Video",        color: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300",            dot: "bg-red-400" },
  doc:          { label: "Design Doc",   color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", dot: "bg-emerald-400" },
  other:        { label: "Other",        color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",          dot: "bg-gray-400" },
};

export function getItemType(proposal) {
  const title = (proposal.title || "").toLowerCase();
  // [RESULT] = vote concluded → treat as announcement
  if (title.startsWith("[result]")) return "announcement";
  // Active votes only
  if (title.startsWith("[vote]") || title.match(/^\[vote\]/)) return "vote";
  if (title.startsWith("[announce")) return "announcement";
  if (
    title.startsWith("[proposal]") ||
    title.startsWith("[rfc]") ||
    title.startsWith("[spec]") ||
    title.startsWith("[spip]")    // Apache Spark improvement proposals
  ) return "proposal";
  if (title.startsWith("[discuss]")) return "discussion";
  if (proposal.kind === "release") return "release";
  if (proposal.kind === "milestone") return "milestone";
  if (proposal.source === "youtube") return "video";
  if (proposal.source === "google_doc") return "doc";
  if (proposal.kind === "pr") return "pr";
  if (proposal.kind === "discussion") return "discussion";
  // Mailing list threads without a tag prefix are discussions
  if (proposal.source === "mailing_list") return "discussion";
  return "other";
}

export function isHot(proposal) {
  if (!proposal.updated_at) return false;
  const days = (Date.now() - new Date(proposal.updated_at).getTime()) / 86400000;
  return days <= 7;
}

/** LLM-free engagement score based on comment count + recency. No API needed. */
export function trendScore(proposal) {
  const comments = parseInt(proposal.comment_count) || 0;
  const days = proposal.updated_at
    ? (Date.now() - new Date(proposal.updated_at).getTime()) / 86400000
    : 999;
  const recency = days <= 7 ? 10 : days <= 30 ? 5 : days <= 90 ? 2 : 0;
  return comments * 2 + recency;
}

export function relativeTime(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
