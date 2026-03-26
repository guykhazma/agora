import { useEffect, useMemo, useState } from "react";
import { fetchEvents } from "../lib/data";

function parseDate(s) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
  const m = blob.match(/https?:\/\/[^\s"'<>\]]+/);
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

function EventRow({ ev }) {
  const start = parseDate(ev.start);
  const end = ev.end ? parseDate(ev.end) : null;
  const action = extractEventActionLink(ev.location, ev.description);

  const dateStr = start
    ? start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : "Unknown date";
  const timeStr = start
    ? start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "";
  const endStr = end ? end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className="bg-white/90 dark:bg-gray-900/90 border border-gray-200/90 dark:border-gray-700 rounded-2xl px-4 py-3 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">
              {ev.title || "Untitled event"}
            </h3>
            <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums">
              {dateStr}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-gray-500 dark:text-gray-400">
            <span className="tabular-nums">{timeStr}{endStr ? `–${endStr}` : ""}</span>
            {ev.calendar && <span>· {ev.calendar}</span>}
            {ev.recurring && <span className="text-indigo-600 dark:text-indigo-300">· recurring</span>}
          </div>
          {ev.location && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">
              {ev.location}
            </p>
          )}
        </div>
        {action && (
          <a
            href={action.href}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 flex-shrink-0 px-2.5 py-1 rounded-lg bg-indigo-50/90 dark:bg-indigo-900/25 border border-indigo-200/60 dark:border-indigo-800/40 hover:bg-indigo-100/90 dark:hover:bg-indigo-900/40 transition-colors focus-ring"
          >
            {action.label}
          </a>
        )}
      </div>
    </div>
  );
}

export default function EventsView({ projectId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    fetchEvents(projectId)
      .then(setData)
      .finally(() => setLoading(false));
  }, [projectId]);

  const events = useMemo(() => {
    const now = Date.now();
    const list = (data?.events || [])
      .map((ev) => ({ ...ev, _ts: parseDate(ev.start)?.getTime() ?? 0 }))
      .filter((ev) => ev._ts && ev._ts >= now - 60_000) // tolerate 1m clock drift
      .sort((a, b) => a._ts - b._ts);
    return list;
  }, [data]);

  const calendars = data?.calendar_urls || [];

  if (loading) return <div className="text-gray-400 py-12 text-center text-sm">Loading…</div>;

  return (
    <div className="space-y-5 fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Upcoming events</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Showing {events.length} event{events.length !== 1 ? "s" : ""} in the next window.
          </p>
        </div>
        {calendars.length > 0 && (
          <div className="flex items-center gap-2">
            {calendars.map((c, i) => (
              <a
                key={i}
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-agora-600 dark:text-agora-400 px-2 py-1 rounded-lg hover:bg-agora-50 dark:hover:bg-agora-900/20 transition-colors focus-ring"
                title={c.name}
              >
                {c.name || "Calendar"} ↗
              </a>
            ))}
          </div>
        )}
      </div>

      {events.length === 0 ? (
        <div className="py-12 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-2xl">
          <p className="text-sm text-gray-500 dark:text-gray-400">No upcoming events found.</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            If this seems wrong, check the calendar crawler output in `data/{projectId}/events.json`.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((ev, idx) => <EventRow key={`${ev.title}-${ev.start}-${idx}`} ev={ev} />)}
        </div>
      )}
    </div>
  );
}

