/**
 * Return the best available display title for a proposal or plain string.
 * - If passed a proposal object: prefers llm_title (LLM-cleaned), falls back to stripping noise from title
 * - If passed a string: strips mailing-list/GitHub prefix tags and Re: chains
 *
 * "[DISCUSS] Re: Re: Branch Merge Strategy" → "Branch Merge Strategy"
 */
export function cleanTitle(proposalOrTitle = "") {
  const raw = typeof proposalOrTitle === "object"
    ? (proposalOrTitle.llm_title || proposalOrTitle.title || "")
    : proposalOrTitle;
  return raw
    .replace(/^(\s*Re:\s*)+/i, "")
    .replace(/^\[(DISCUSS|PROPOSAL|RFC|VOTE|RESULT|ANNOUNCE|ANNOUNCEMENT|SPEC|WIP)\]\s*/i, "")
    .replace(/^(\s*Re:\s*)+/i, "")   // second pass catches "[DISCUSS] Re: ..."
    .trim();
}

/**
 * Summarize source composition of a set of proposals into readable pills.
 * e.g. ["github","github","mailing_list","youtube"] →
 *   [{ label: "GitHub ×2", … }, { label: "Mailing List", … }, { label: "Video", … }]
 */
export function sourceBreakdown(proposals) {
  const counts = {};
  for (const p of proposals) counts[p.source] = (counts[p.source] || 0) + 1;

  const ORDER = ["github", "mailing_list", "youtube", "google_doc"];
  const LABELS = {
    github:       { label: "GitHub",       color: "bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300" },
    mailing_list: { label: "Mailing List", color: "bg-indigo-50 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300" },
    youtube:      { label: "Video",        color: "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300" },
    google_doc:   { label: "Sync Notes",   color: "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300" },
  };

  return [...ORDER, ...Object.keys(counts).filter((s) => !ORDER.includes(s))]
    .filter((s) => counts[s])
    .map((s) => ({
      source: s,
      count: counts[s],
      label: LABELS[s]?.label || s,
      color: LABELS[s]?.color || "bg-gray-800 text-gray-400",
    }));
}
