import { useState, useEffect } from "react";

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function periodLabel(period) {
  if (period === "last_14_days") return "Past 2 weeks";
  if (period === "latest_activity") return "Latest activity";
  return "This week";
}

function coverageLine(digest) {
  if (!digest?.coverage?.from || !digest?.coverage?.to) return null;
  const n = digest.coverage.thread_count ?? digest.item_count;
  const range =
    digest.coverage.from === digest.coverage.to
      ? digest.coverage.from
      : `${digest.coverage.from}–${digest.coverage.to}`;
  return `Based on ${n} threads updated ${range} (UTC)`;
}

export default function DigestBanner({ projectId, compact = false }) {
  const [digest, setDigest] = useState(null);
  const [phase, setPhase] = useState(() => (projectId ? "loading" : "idle"));

  useEffect(() => {
    if (!projectId) {
      setPhase("idle");
      setDigest(null);
      return;
    }
    const base = import.meta.env.VITE_BASE_PATH?.replace(/\/$/, "") || "";
    setPhase("loading");
    setDigest(null);
    // no-store: after regenerating digest locally, a normal reload must not use a cached JSON
    fetch(`${base}/data/${projectId}/digest.json`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setDigest(data);
        setPhase(data?.summary ? "ready" : "missing");
      })
      .catch(() => {
        setDigest(null);
        setPhase("missing");
      });
  }, [projectId]);

  const hasSummary = digest?.summary;

  if (!projectId) return null;

  if (compact) {
    if (phase === "loading" || !hasSummary) return null;
    const cov = coverageLine(digest);
    return (
      <div className="relative overflow-hidden rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-agora-400 to-indigo-500" aria-hidden />
        <div className="pl-4 pr-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className="text-xs font-semibold text-agora-600 dark:text-agora-400 uppercase tracking-wider">Digest</span>
            {digest.generated_at && (
              <span className="text-xs text-gray-400 dark:text-gray-500">{formatDate(digest.generated_at)}</span>
            )}
          </div>
          {cov && (
            <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1 line-clamp-1" title={cov}>
              {cov}
            </p>
          )}
          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-3">{digest.summary}</p>
        </div>
      </div>
    );
  }

  // Full-width Overview variant
  if (phase === "loading") {
    return (
      <div className="rounded-2xl border border-gray-200/90 dark:border-gray-700 bg-white/60 dark:bg-gray-900/40 px-5 py-4 shadow-sm" aria-busy="true">
        <div className="h-3 w-24 skeleton mb-3" />
        <div className="h-3 w-full skeleton mb-2 opacity-80" />
        <div className="h-3 w-4/5 max-w-lg skeleton opacity-60" />
      </div>
    );
  }

  if (phase === "missing" || !hasSummary) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300/90 dark:border-gray-600 bg-white/50 dark:bg-gray-900/30 px-5 py-4">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Digest</p>
        <p className="text-sm text-gray-600 dark:text-gray-300">No digest yet — run a crawl with an LLM API key to summarize recent activity.</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 space-y-1">
          <span className="block">
            <code className="text-[11px] bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">python scripts/crawl.py --project {projectId || "…"}</code>
          </span>
          <span className="block">
            Or refresh digest only:{" "}
            <code className="text-[11px] bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
              python scripts/generate_digest.py --project {projectId || "…"}
            </code>
          </span>
        </p>
      </div>
    );
  }

  const covFull = coverageLine(digest);
  return (
    <div className="relative overflow-hidden rounded-2xl border border-agora-200/70 dark:border-agora-800/80 bg-gradient-to-br from-white via-agora-50/40 to-indigo-50/30 dark:from-gray-900 dark:via-gray-900 dark:to-agora-950/30 shadow-md shadow-agora-900/5 dark:shadow-none">
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-agora-400 to-indigo-500" aria-hidden />
      <div className="relative px-5 py-4 pl-6">
        <div className="flex items-start gap-5">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
              <span className="text-xs font-semibold text-agora-700 dark:text-agora-300 uppercase tracking-wider">Digest</span>
              {digest.period && (
                <span className="text-[10px] font-medium uppercase tracking-wide text-agora-600/80 dark:text-agora-400/90 bg-agora-100/80 dark:bg-agora-900/40 px-2 py-0.5 rounded-full">
                  {periodLabel(digest.period)}
                </span>
              )}
              {digest.generated_at && (
                <span className="text-xs text-gray-400 dark:text-gray-500">· {formatDate(digest.generated_at)}</span>
              )}
            </div>
            {covFull && <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">{covFull}</p>}
            <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">{digest.summary}</p>
          </div>
          {digest.highlights?.length > 0 && (
            <ul className="hidden md:block space-y-2 flex-shrink-0 max-w-xs border-l border-gray-200/80 dark:border-gray-700 pl-5">
              {digest.highlights.slice(0, 3).map((h, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400 leading-snug">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-agora-400 flex-shrink-0" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
