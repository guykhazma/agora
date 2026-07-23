/**
 * HealthPanel — a CHAOSS-inspired, at-a-glance community health card.
 *
 * All metrics are computed client-side from data the Overview already loads
 * (proposal index rows + initiatives). No new network calls, no LLM. Everything
 * is a heuristic proxy and labelled as such.
 *
 *   • Responsiveness   — median created→updated for commented items (last ~90d)
 *   • Contributor mix  — bus factor: fewest authors making 50% of recent activity
 *   • Activity trend   — item updates per week over the last 12 weeks (sparkline)
 */
import { useMemo } from "react";

const DAY = 86400000;
const WEEK = 7 * DAY;
const WINDOW_DAYS = 90;
const TREND_WEEKS = 12;

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function formatDuration(ms) {
  if (ms == null) return "—";
  const h = ms / 3600000;
  if (h < 1) return "<1h";
  if (h < 24) return `${Math.round(h)}h`;
  const d = ms / DAY;
  if (d < 14) return `${Math.round(d)}d`;
  if (d < 60) return `${Math.round(d / 7)}w`;
  return `${Math.round(d / 30)}mo`;
}

function cleanAuthor(a) {
  return (a || "").replace(/\s*<.*>/, "").trim();
}

export default function HealthPanel({ proposals = [], initiatives = [] }) {
  const metrics = useMemo(() => {
    const now = Date.now();
    const cutoff = now - WINDOW_DAYS * DAY;
    const recent = proposals.filter((p) => {
      const t = p.updated_at ? new Date(p.updated_at).getTime() : NaN;
      return Number.isFinite(t) && t >= cutoff;
    });

    // ── Responsiveness — created→updated for items that actually drew replies ──
    const responseTimes = [];
    for (const p of recent) {
      const comments = parseInt(p.comment_count) || 0;
      if (comments <= 0) continue;
      const created = p.created_at ? new Date(p.created_at).getTime() : NaN;
      const updated = p.updated_at ? new Date(p.updated_at).getTime() : NaN;
      if (!Number.isFinite(created) || !Number.isFinite(updated)) continue;
      const delta = updated - created;
      if (delta >= 0) responseTimes.push(delta);
    }
    const medianResponse = median(responseTimes);
    // Distribution buckets for the little bar row.
    const buckets = [
      { label: "<1d", max: DAY },
      { label: "1–7d", max: WEEK },
      { label: "1–4w", max: 4 * WEEK },
      { label: ">4w", max: Infinity },
    ].map((b) => ({ ...b, count: 0 }));
    for (const d of responseTimes) {
      const bkt = buckets.find((b) => d < b.max) || buckets[buckets.length - 1];
      bkt.count += 1;
    }
    const bucketMax = Math.max(1, ...buckets.map((b) => b.count));

    // ── Bus factor — fewest authors producing 50% of recent activity ──
    const byAuthor = new Map();
    for (const p of recent) {
      const a = cleanAuthor(p.author);
      if (!a) continue;
      byAuthor.set(a, (byAuthor.get(a) || 0) + 1);
    }
    const ranked = [...byAuthor.entries()].sort((a, b) => b[1] - a[1]);
    const totalAuthored = ranked.reduce((s, [, n]) => s + n, 0);
    let busFactor = 0;
    let cum = 0;
    for (const [, n] of ranked) {
      busFactor += 1;
      cum += n;
      if (cum >= totalAuthored / 2) break;
    }
    const topContributors = ranked.slice(0, 4).map(([name, n]) => ({
      name,
      n,
      pct: totalAuthored ? Math.round((n / totalAuthored) * 100) : 0,
    }));

    // ── Activity trend — updates per week over the last 12 weeks ──
    const trend = Array.from({ length: TREND_WEEKS }, () => 0);
    const trendStart = now - TREND_WEEKS * WEEK;
    for (const p of proposals) {
      const t = p.updated_at ? new Date(p.updated_at).getTime() : NaN;
      if (!Number.isFinite(t) || t < trendStart || t > now) continue;
      const idx = Math.min(TREND_WEEKS - 1, Math.floor((t - trendStart) / WEEK));
      trend[idx] += 1;
    }
    const trendMax = Math.max(1, ...trend);
    const trendTotal = trend.reduce((s, n) => s + n, 0);

    return {
      medianResponse,
      responseSample: responseTimes.length,
      buckets,
      bucketMax,
      busFactor,
      contributors: byAuthor.size,
      topContributors,
      recentCount: recent.length,
      trend,
      trendMax,
      trendTotal,
      initiativeCount: initiatives.length,
    };
  }, [proposals, initiatives]);

  // Nothing meaningful to show (e.g. empty project) — stay out of the way.
  if (!proposals.length) return null;

  const {
    medianResponse, responseSample, buckets, bucketMax,
    busFactor, contributors, topContributors,
    trend, trendMax, trendTotal, recentCount, initiativeCount,
  } = metrics;

  return (
    <section
      className="rounded-2xl border border-gray-200/90 dark:border-gray-700 bg-white/90 dark:bg-gray-900/90 shadow-sm overflow-hidden"
      aria-label="Community health (heuristic)"
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
        <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
          Community Health
        </h2>
        <span
          className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full"
          title="Lightweight heuristics computed from public activity metadata — directional signals, not exact measures."
        >
          Heuristic
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-100 dark:divide-gray-800">

        {/* Responsiveness */}
        <div className="px-5 py-4">
          <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">
            Typical response
          </p>
          <div className="flex items-baseline gap-1.5 mb-3">
            <span className="text-2xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
              {formatDuration(medianResponse)}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">median</span>
          </div>
          {responseSample > 0 ? (
            <div className="space-y-1">
              {buckets.map((b) => (
                <div key={b.label} className="flex items-center gap-2">
                  <span className="w-9 text-[10px] text-gray-400 dark:text-gray-500 tabular-nums text-right flex-shrink-0">{b.label}</span>
                  <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-agora-400 dark:bg-agora-500"
                      style={{ width: `${(b.count / bucketMax) * 100}%` }}
                    />
                  </div>
                  <span className="w-5 text-[10px] text-gray-400 dark:text-gray-500 tabular-nums flex-shrink-0">{b.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500">No commented items in the last {WINDOW_DAYS} days.</p>
          )}
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
            {responseSample} commented item{responseSample !== 1 ? "s" : ""}, last {WINDOW_DAYS}d
          </p>
        </div>

        {/* Bus factor */}
        <div className="px-5 py-4">
          <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">
            Contributor mix
          </p>
          <div className="flex items-baseline gap-1.5 mb-3">
            <span className="text-2xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
              {busFactor || "—"}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              author{busFactor !== 1 ? "s" : ""} = 50% of activity
            </span>
          </div>
          {topContributors.length > 0 ? (
            <div className="space-y-1">
              {topContributors.map((c) => (
                <div key={c.name} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 text-xs text-gray-600 dark:text-gray-300 truncate" title={c.name}>{c.name}</span>
                  <div className="w-16 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden flex-shrink-0">
                    <div className="h-full rounded-full bg-agora-400 dark:bg-agora-500" style={{ width: `${c.pct}%` }} />
                  </div>
                  <span className="w-8 text-[10px] text-gray-400 dark:text-gray-500 tabular-nums text-right flex-shrink-0">{c.pct}%</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500">No author data available.</p>
          )}
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
            {contributors} contributor{contributors !== 1 ? "s" : ""} across {recentCount} recent item{recentCount !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Activity trend */}
        <div className="px-5 py-4">
          <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">
            Activity trend
          </p>
          <div className="flex items-baseline gap-1.5 mb-3">
            <span className="text-2xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{trendTotal}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">updates / {TREND_WEEKS}w</span>
          </div>
          <Sparkline values={trend} max={trendMax} />
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
            {initiativeCount} initiative{initiativeCount !== 1 ? "s" : ""} tracked · per-week item updates
          </p>
        </div>
      </div>
    </section>
  );
}

/** Bare weekly-activity bars — single hue, anchored to baseline, 2px gaps. */
function Sparkline({ values, max }) {
  const W = 160;
  const H = 40;
  const n = values.length;
  const gap = 2;
  const barW = (W - gap * (n - 1)) / n;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-10" preserveAspectRatio="none" role="img" aria-label={`Weekly activity over the last ${n} weeks`}>
      {values.map((v, i) => {
        const h = max > 0 ? (v / max) * (H - 2) : 0;
        const x = i * (barW + gap);
        const y = H - h;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={Math.max(h, 1)}
            rx="1.5"
            className="fill-agora-400 dark:fill-agora-500"
          >
            <title>{`Week ${i + 1}: ${v} update${v !== 1 ? "s" : ""}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
