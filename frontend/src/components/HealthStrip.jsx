/**
 * Per-source pipeline health for the active project + an RSS subscribe link.
 * Reads /data/health.json (best-effort — renders just the RSS link if absent).
 * Each source is a chip coloured green / amber / red by ok · stale · error, with
 * a tooltip showing last success time and any error message.
 */
import { useEffect, useState } from "react";
import { fetchHealth, feedUrl, relativeTime, SOURCE_META } from "../lib/data";

const CHIP = {
  ok:    "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/25 dark:text-green-300 dark:border-green-800/60",
  stale: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/25 dark:text-amber-300 dark:border-amber-800/60",
  error: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/25 dark:text-red-300 dark:border-red-800/60",
};
const DOT = { ok: "bg-green-500", stale: "bg-amber-500", error: "bg-red-500" };

function sourceState(s) {
  if (s?.ok) return "ok";
  if (s?.error) return "error";
  return "stale";
}

export default function HealthStrip({ projectId }) {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setHealth(null);
    fetchHealth(projectId).then((h) => { if (alive) setHealth(h); });
    return () => { alive = false; };
  }, [projectId]);

  if (!projectId) return null;

  const sources = health?.sources ? Object.entries(health.sources) : [];

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold text-[10px] mr-0.5">
            Sources
          </span>
          {sources.map(([key, s]) => {
            const state = sourceState(s);
            const label = SOURCE_META[key]?.label || key.replace(/_/g, " ");
            const lastOk = s?.last_success_at ? relativeTime(s.last_success_at) : "never";
            const tip = [
              `${label}: ${state}`,
              `${s?.item_count ?? 0} items`,
              `last success ${lastOk}`,
              s?.error ? `error: ${s.error}` : null,
            ].filter(Boolean).join(" · ");
            return (
              <span
                key={key}
                title={tip}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-medium ${CHIP[state]}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT[state]}`} />
                {label}
                {typeof s?.item_count === "number" && (
                  <span className="tabular-nums opacity-70">{s.item_count}</span>
                )}
              </span>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-3 ml-auto">
        {health?.last_crawled_at && (
          <span className="text-gray-400 dark:text-gray-500" title={`Last crawled ${new Date(health.last_crawled_at).toLocaleString()}`}>
            Crawled {relativeTime(health.last_crawled_at)}
          </span>
        )}
        <a
          href={feedUrl(projectId)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-agora-600 dark:text-agora-400 hover:text-agora-700 dark:hover:text-agora-300 px-2 py-0.5 rounded-md hover:bg-agora-50 dark:hover:bg-agora-900/20 transition-colors focus-ring"
          title="Subscribe to the project RSS feed"
        >
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor" aria-hidden="true">
            <circle cx="6.18" cy="17.82" r="2.18" />
            <path d="M4 4v3a13 13 0 0113 13h3A16 16 0 004 4z" />
            <path d="M4 10.1V13a7 7 0 017 7h2.9A9.9 9.9 0 004 10.1z" />
          </svg>
          Subscribe (RSS)
        </a>
      </div>
    </div>
  );
}
