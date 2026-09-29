/** Read both legacy digests and source-linked digests; never invent provenance. */
export function digestHighlights(digest) {
  return (digest?.highlights || []).map(h => typeof h === "string"
    ? { text: h, sources: [] }
    : { text: h.text, sources: (h.sources || []).filter(s => /^https?:\/\//.test(s.url || "")) });
}

export function generationLabel(generation) {
  if (generation?.method === "local") return "Extracted from source summaries";
  if (generation?.method === "llm") return `AI summary · ${generation.model || generation.provider || "LLM"}`;
  return null;
}

export function changeLabel(change, item) {
  if (change.field === "vote_result") {
    const labels = { passed: "approval threshold reached", vetoed: "negative vote recorded", open: "open" };
    return `Vote tally: ${labels[change.to] || change.to} (inferred)`;
  }
  if (change.field === "state") {
    const subject = item.kind === "pr" ? "PR" : "Item";
    return `${subject}: ${change.from} → ${change.to}`;
  }
  return null;
}

export function observedChanges(proposals, since, limit = 8) {
  if (!Number.isFinite(since)) return [];
  return proposals.flatMap(item => (item.observed_history || []).map(change => ({
    item, date: change.observed_at, label: changeLabel(change, item),
  }))).filter(e => e.label && Date.parse(e.date) > since)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, limit);
}

export function initiativeHistory(members) {
  const events = members.flatMap(item => {
    const title = (item.title || "").replace(/^(?:re:\s*)+/i, "");
    const opened = /^\[result\]/i.test(title) ? "Result thread posted"
      : /^\[vote\]/i.test(title) ? "Vote thread opened"
      : item.kind === "pr" ? "PR opened"
      : item.kind === "release" ? "Release published"
      : item.source === "youtube" ? "Video published"
      : item.kind === "issue" ? "Issue opened" : "Discussion opened";
    const baseline = item.created_at && item.kind !== "document" && item.kind !== "milestone"
      ? [{ item, date: item.kind === "release" ? item.updated_at : item.created_at, label: opened, observed: false }]
      : [];
    return [...baseline, ...(item.observed_history || []).map(change => ({
      item, date: change.observed_at, label: changeLabel(change, item), observed: true,
    }))];
  });
  return events.filter(e => e.label && Number.isFinite(Date.parse(e.date)))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 12);
}

export function highlightsMarkdown(digest) {
  return digestHighlights(digest).map(h => `- ${h.text}${h.sources.length ? " " : ""}${h.sources.map((s, i) =>
    `[Source ${i + 1}](${s.url.replace(/\(/g, "%28").replace(/\)/g, "%29")})`).join(" ")}`);
}
