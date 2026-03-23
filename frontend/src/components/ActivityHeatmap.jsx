/**
 * ActivityHeatmap — GitHub contribution graph style.
 * Shows the last 16 weeks of governance activity:
 * how many proposals were updated each day.
 */

import { useMemo } from "react";

const WEEKS = 16;
const DAYS = 7;

function getIntensityClass(count) {
  if (count === 0) return "bg-gray-100 dark:bg-gray-800";
  if (count <= 1) return "bg-agora-200 dark:bg-agora-900";
  if (count <= 3) return "bg-agora-400 dark:bg-agora-700";
  if (count <= 6) return "bg-agora-500 dark:bg-agora-600";
  return "bg-agora-600 dark:bg-agora-500";
}

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

export default function ActivityHeatmap({ proposals }) {
  const { grid, weekLabels, maxCount } = useMemo(() => {
    // Count proposals updated per day
    const counts = {};
    for (const p of proposals) {
      if (!p.updated_at) continue;
      const key = toDateKey(new Date(p.updated_at));
      counts[key] = (counts[key] || 0) + 1;
    }

    // Build a 16×7 grid anchored to today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Start from the beginning of the week 16 weeks ago
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - (WEEKS * 7 - 1));

    const grid = []; // grid[week][day]
    const weekLabels = [];

    for (let w = 0; w < WEEKS; w++) {
      const week = [];
      for (let d = 0; d < DAYS; d++) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + w * 7 + d);
        const key = toDateKey(date);
        week.push({ date, key, count: counts[key] || 0 });
      }
      grid.push(week);
      // Label every 4 weeks
      if (w % 4 === 0) {
        weekLabels.push({
          week: w,
          label: grid[w][0].date.toLocaleString("default", { month: "short" }),
        });
      }
    }

    const maxCount = Math.max(1, ...Object.values(counts));
    return { grid, weekLabels, maxCount };
  }, [proposals]);

  const totalActive = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - WEEKS * 7);
    return proposals.filter(
      (p) => p.updated_at && new Date(p.updated_at) >= cutoff
    ).length;
  }, [proposals]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Activity</span>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {totalActive} items in last {WEEKS} weeks
        </span>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-800 px-3 py-3">
        {/* Month labels */}
        <div className="flex gap-1 mb-1 pl-5">
          {Array.from({ length: WEEKS }).map((_, w) => {
            const label = weekLabels.find((l) => l.week === w);
            return (
              <div key={w} className="w-3 text-xs text-gray-400 dark:text-gray-600 flex-shrink-0">
                {label ? label.label : ""}
              </div>
            );
          })}
        </div>

        <div className="flex gap-1">
          {/* Day-of-week labels */}
          <div className="flex flex-col gap-1 pr-1">
            {["M", "", "W", "", "F", "", "S"].map((d, i) => (
              <div key={i} className="h-3 w-4 text-xs text-gray-400 dark:text-gray-600 flex items-center">
                {d}
              </div>
            ))}
          </div>

          {/* Grid */}
          {grid.map((week, w) => (
            <div key={w} className="flex flex-col gap-1">
              {week.map(({ date, key, count }) => (
                <div
                  key={key}
                  title={`${date.toDateString()}: ${count} update${count !== 1 ? "s" : ""}`}
                  className={`w-3 h-3 rounded-sm flex-shrink-0 transition-opacity hover:opacity-70 cursor-default ${getIntensityClass(count)}`}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-1.5 mt-2 justify-end">
          <span className="text-xs text-gray-400 dark:text-gray-600">Less</span>
          {[
            "bg-gray-100 dark:bg-gray-800",
            "bg-agora-200 dark:bg-agora-900",
            "bg-agora-400 dark:bg-agora-700",
            "bg-agora-500 dark:bg-agora-600",
            "bg-agora-600 dark:bg-agora-500",
          ].map((c, i) => (
            <div key={i} className={`w-3 h-3 rounded-sm ${c}`} />
          ))}
          <span className="text-xs text-gray-400 dark:text-gray-600">More</span>
        </div>
      </div>
    </div>
  );
}
