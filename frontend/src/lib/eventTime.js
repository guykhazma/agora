/**
 * Calendar event times from the API are UTC ISO strings.
 * All display uses the viewer's local timezone explicitly so behavior is
 * consistent across browsers and it's obvious we're not showing UTC.
 */

/** @returns {string|undefined} IANA zone, e.g. "America/New_York" */
export function getViewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** @param {string|undefined} iso */
export function parseEventInstant(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const tz = () => getViewerTimeZone();

/**
 * @param {Date} date
 * @param {Intl.DateTimeFormatOptions} base
 */
function withLocalZone(base) {
  const z = tz();
  return z ? { ...base, timeZone: z } : base;
}

/** @param {Date|null} date */
export function formatEventWeekdayDate(date, locale) {
  if (!date) return "Unknown date";
  return date.toLocaleDateString(
    locale,
    withLocalZone({
      weekday: "short",
      month: "short",
      day: "numeric",
    })
  );
}

/** Compact date for tight layouts (e.g. home sidebar): "Mar 30" in local TZ */
export function formatEventMonthDayLocal(date, locale) {
  if (!date) return "";
  return date.toLocaleDateString(
    locale,
    withLocalZone({ month: "short", day: "numeric" })
  );
}

/** Short timezone label for one instant, e.g. "GMT+2" or "PST" */
export function formatTimeZoneShort(date, locale) {
  if (!date) return "";
  const parts = new Intl.DateTimeFormat(locale, {
    ...withLocalZone({ timeZoneName: "short" }),
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(date);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}

/**
 * @param {Date|null} start
 * @param {Date|null} end
 * @returns {{ timeRange: string, zoneShort: string }}
 */
export function formatEventLocalTimeRange(start, end, locale) {
  if (!start) return { timeRange: "", zoneShort: "" };
  const timeOpts = withLocalZone({ hour: "2-digit", minute: "2-digit" });
  const a = start.toLocaleTimeString(locale, timeOpts);
  if (end && !Number.isNaN(end.getTime())) {
    const b = end.toLocaleTimeString(locale, timeOpts);
    return {
      timeRange: `${a}–${b}`,
      zoneShort: formatTimeZoneShort(start, locale),
    };
  }
  return {
    timeRange: a,
    zoneShort: formatTimeZoneShort(start, locale),
  };
}

/** One-line hint for list headers, e.g. "America/Los_Angeles" */
export function localTimeHint() {
  const z = getViewerTimeZone();
  return z ? z.replace(/_/g, " ") : "local time";
}
