/**
 * DocsView — Design document hub.
 *
 * Shows:
 *   1. Directly tracked community docs (google_doc source proposals)
 *   2. Design docs referenced across multiple discussions (cross-source signal)
 *
 * Value: "Which design documents are actively shaping discussions?"
 */

import { useMemo, useState } from "react";
import { SOURCE_META, relativeTime, getItemType } from "../lib/data";
import { cleanTitle } from "../lib/utils";

// ── Linked doc entry helpers ──────────────────────────────────────────────────
// Titles that are not meaningful (from markdown link text like [v2], [here], [link])
const _JUNK_TITLES = new Set(["v1","v2","v3","v4","link","here","doc","this","click","see","design","draft","pr","rfc"]);

function docLabel(entry) {
  const t = entry.title?.trim();
  // Use title only if it looks meaningful (>4 chars and not a stop phrase)
  if (t && t.length > 4 && !_JUNK_TITLES.has(t.toLowerCase())) return t;
  // Use the first reference proposal's title as a hint
  if (entry.refs?.length > 0) {
    const refTitle = entry.refs[0].title || "";
    const cleaned = refTitle.replace(/^\[[^\]]+\]\s*/, "").trim();
    if (cleaned.length > 8) return `Doc: ${cleaned.slice(0, 50)}`;
  }
  try {
    const match = new URL(entry.url).pathname.match(/\/d\/([^/]+)/);
    if (match) return `Design Doc · ${match[1].slice(0, 16)}…`;
  } catch { /* ignore */ }
  return entry.url.slice(0, 60);
}

// ── Community Sync Doc card ───────────────────────────────────────────────────
function LiveDocCard({ p, onSelect }) {
  const comments = parseInt(p.comment_count) || 0;
  return (
    <div className="bg-white/90 dark:bg-gray-900/90 border border-emerald-200/80 dark:border-emerald-800/60 border-l-4 border-l-emerald-500 rounded-2xl px-4 py-4 shadow-sm hover:shadow-md transition-all duration-300">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex-1">{cleanTitle(p)}</h3>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            Live doc
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">{relativeTime(p.updated_at)}</span>
        </div>
      </div>

      {p.llm_summary && (
        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed mb-2 line-clamp-3">
          {p.llm_summary}
        </p>
      )}

      {p.llm_key_points?.length > 0 && (
        <ul className="space-y-1 mb-3">
          {p.llm_key_points.slice(0, 4).map((pt, i) => (
            <li key={i} className="text-xs text-gray-500 dark:text-gray-400 flex items-start gap-2">
              <span className="text-emerald-500 mt-0.5 flex-shrink-0">·</span>
              <span>{pt}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3">
        <a
          href={p.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
        >
          Open doc ↗
        </a>
        <button
          type="button"
          onClick={() => onSelect(p)}
          className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-agora-600 dark:hover:text-agora-400 px-2 py-0.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus-ring"
        >
          Summary
        </button>
        {p.llm_topics?.length > 0 && (
          <div className="flex flex-wrap gap-1 ml-auto">
            {p.llm_topics.slice(0, 3).map(t => (
              <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Linked design doc card ────────────────────────────────────────────────────
function LinkedDocCard({ doc, onSelect }) {
  const label    = docLabel(doc);
  const sources  = [...new Set(doc.refs.map(r => r.source))];
  const isCrossSource = sources.length > 1;
  const mostRecent = doc.refs.reduce((a, b) =>
    (b.updated_at || "") > (a.updated_at || "") ? b : a, doc.refs[0]);

  return (
    <div className={`bg-white/90 dark:bg-gray-900/90 border overflow-hidden rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 ${
      isCrossSource
        ? "border-agora-200/80 dark:border-agora-800/60 border-l-4 border-l-agora-400"
        : "border-gray-200/90 dark:border-gray-700 border-l-4 border-l-gray-300 dark:border-l-gray-600"
    }`}>
      <div className="px-4 py-3">
        <div className="flex items-start gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <a
              href={doc.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-semibold text-gray-900 dark:text-gray-100 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors leading-snug"
            >
              {label} ↗
            </a>
          </div>
          <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
            {relativeTime(mostRecent?.updated_at)}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {sources.map(s => {
            const srcMeta = SOURCE_META[s] || { label: s, color: "bg-gray-100 text-gray-600" };
            return (
              <span key={s} className={`text-xs px-1.5 py-0.5 rounded ${srcMeta.color}`}>
                {srcMeta.label}
              </span>
            );
          })}
          <span className="text-xs text-gray-400 dark:text-gray-500">
            · {doc.refs.length} reference{doc.refs.length !== 1 ? "s" : ""}
          </span>
          {doc.fetched && (
            <span className="text-xs text-emerald-600 dark:text-emerald-500">· content extracted</span>
          )}
        </div>
      </div>

      <div className="border-t border-gray-100 dark:border-gray-800">
        {doc.refs.slice(0, 5).map(p => {
          const srcMeta = SOURCE_META[p.source] || { label: p.source, color: "bg-gray-100 text-gray-600" };
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect?.(p)}
              className="w-full text-left flex items-center gap-2 px-4 py-2.5 text-xs hover:bg-agora-50/50 dark:hover:bg-gray-800/80 transition-colors group border-b border-gray-100/90 dark:border-gray-800 last:border-b-0 focus-ring"
            >
              <span className={`px-1.5 py-0.5 rounded w-20 text-center flex-shrink-0 ${srcMeta.color}`}>
                {srcMeta.label}
              </span>
              <span className="flex-1 text-gray-700 dark:text-gray-300 truncate group-hover:text-gray-900 dark:group-hover:text-gray-100">
                {cleanTitle(p)}
              </span>
              <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">{relativeTime(p.updated_at)}</span>
              <span className="text-gray-300 dark:text-gray-600 group-hover:text-gray-500 flex-shrink-0">→</span>
            </button>
          );
        })}
        {doc.refs.length > 5 && (
          <div className="px-4 py-1.5 text-xs text-gray-400 dark:text-gray-500">
            +{doc.refs.length - 5} more discussions
          </div>
        )}
      </div>
    </div>
  );
}

// ── Docs grouped under a single source proposal ───────────────────────────────
function ProposalDocGroup({ proposal: p, docs, onSelect }) {
  const [open, setOpen] = useState(false);
  const srcMeta = SOURCE_META[p.source] || { label: p.source, color: "bg-gray-100 text-gray-600" };
  return (
    <div className="border border-gray-200/90 dark:border-gray-700 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left bg-white/90 dark:bg-gray-900/90 hover:bg-gray-50/80 dark:hover:bg-gray-800/60 transition-colors focus-ring"
      >
        <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${srcMeta.color}`}>{srcMeta.label}</span>
        <span className="flex-1 text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{cleanTitle(p)}</span>
        <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">{docs.length} doc{docs.length !== 1 ? "s" : ""}</span>
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">{open ? "↑" : "↓"}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {docs.map(doc => (
            <a
              key={doc.url}
              href={doc.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-4 py-2 text-xs hover:bg-gray-50/80 dark:hover:bg-gray-800/60 transition-colors group"
            >
              <span className="text-emerald-500 flex-shrink-0">↗</span>
              <span className="flex-1 text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 truncate">
                {docLabel(doc)}
              </span>
              {doc.fetched && <span className="text-xs text-emerald-600 dark:text-emerald-500 flex-shrink-0">extracted</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function DocsView({ proposals, onSelect }) {
  const [search, setSearch] = useState("");

  // Direct community docs (live tracked)
  const liveDocs = useMemo(() =>
    proposals.filter(p => p.source === "google_doc")
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")),
    [proposals]
  );

  // Docs referenced in discussions (linked_resources)
  const linkedDocs = useMemo(() => {
    // Normalize a Google Doc URL to just the doc ID (strips edit/view, anchors, query params).
    // For non-Google URLs, strip query + fragment.
    function docKey(url) {
      const m = url.match(/\/document\/d\/([A-Za-z0-9_-]+)/);
      if (m) return `gdoc:${m[1]}`;
      return url.split("?")[0].split("#")[0].replace(/\/+$/, "");
    }

    const map = new Map();
    for (const p of proposals) {
      for (const r of p.linked_resources || []) {
        if (r.kind !== "google_doc" && r.kind !== "google_drive") continue;
        const key = docKey(r.url);
        if (!map.has(key)) {
          map.set(key, { url: r.url, title: r.title || "", fetched: r.fetched ?? false, refs: [] });
        }
        const entry = map.get(key);
        if (r.fetched) entry.fetched = true;
        if (r.title && !entry.title) entry.title = r.title;
        if (!entry.refs.some(x => x.id === p.id)) entry.refs.push(p);
      }
    }
    return [...map.values()].sort((a, b) => {
      const aRecent = a.refs.reduce((m, r) => (r.updated_at || "") > m ? (r.updated_at || "") : m, "");
      const bRecent = b.refs.reduce((m, r) => (r.updated_at || "") > m ? (r.updated_at || "") : m, "");
      return bRecent.localeCompare(aRecent);
    });
  }, [proposals]);

  // Build a unified sorted list of "items":
  //   - docs cited by 2+ proposals → standalone LinkedDocCard  (date = most recent ref)
  //   - docs cited by only 1 proposal → grouped under their proposal (date = proposal.updated_at)
  //     but if a proposal only has 1 doc, show it as a standalone card too (no grouping needed)
  const items = useMemo(() => {
    const groups = new Map(); // proposalId → { proposal, docs[], date }
    const standalone = [];    // cross-cutting docs

    for (const doc of linkedDocs) {
      if (doc.refs.length >= 2) {
        const date = doc.refs.reduce((m, r) => (r.updated_at || "") > m ? (r.updated_at || "") : m, "");
        standalone.push({ type: "doc", doc, date });
      } else {
        const p = doc.refs[0];
        if (!p) continue;
        if (!groups.has(p.id)) groups.set(p.id, { proposal: p, docs: [], date: p.updated_at || "" });
        groups.get(p.id).docs.push(doc);
      }
    }

    // Groups with only 1 doc → promote to standalone
    const result = [...standalone];
    for (const g of groups.values()) {
      if (g.docs.length === 1) {
        result.push({ type: "doc", doc: g.docs[0], date: g.date });
      } else {
        result.push({ type: "group", ...g });
      }
    }

    return result.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [linkedDocs]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(item => {
      if (item.type === "doc") {
        return docLabel(item.doc).toLowerCase().includes(q) ||
          item.doc.refs.some(p => p.title?.toLowerCase().includes(q));
      }
      return item.docs.some(d => docLabel(d).toLowerCase().includes(q)) ||
        item.proposal.title?.toLowerCase().includes(q);
    });
  }, [items, search]);

  return (
    <div className="space-y-8 fade-in">

      {/* Community sync docs */}
      {liveDocs.length > 0 && (
        <section>
          <div className="flex items-baseline gap-2 mb-3">
            <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
              Community Docs
            </h2>
            <span className="text-xs text-gray-400 dark:text-gray-600">
              shared notes, always up to date
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {liveDocs.map(p => <LiveDocCard key={p.id} p={p} onSelect={onSelect} />)}
          </div>
        </section>
      )}

      {/* All design docs — unified list sorted by date */}
      <section>
        <div className="flex items-baseline gap-3 mb-3">
          <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
            Design References
          </h2>
          <span className="text-xs text-gray-400 dark:text-gray-600">
            Google Docs linked in GitHub, PRs, or mailing list threads
          </span>
        </div>

        {items.length === 0 ? (
          <div className="py-12 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-md">
            <p className="text-sm text-gray-500 dark:text-gray-400">No linked design documents found.</p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <input
                type="text"
                placeholder="Search documents or discussions…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 max-w-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500"
              />
              <span className="text-xs text-gray-400 dark:text-gray-600">{filtered.length} of {items.length}</span>
            </div>
            <div className="space-y-2">
              {filtered.map(item =>
                item.type === "doc"
                  ? <LinkedDocCard key={item.doc.url} doc={item.doc} onSelect={onSelect} />
                  : <ProposalDocGroup key={item.proposal.id} proposal={item.proposal} docs={item.docs} onSelect={onSelect} />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
