/**
 * Client-side user preferences, persisted in localStorage. No server, no account.
 *
 *  - Watchlist: star proposals/initiatives to follow. A single external store is
 *    shared by every card (via useSyncExternalStore) so hundreds of cards don't
 *    each register their own listener. Synced across tabs.
 *  - Last visit: per-project "what changed since you were last here" timestamp.
 */
import { useSyncExternalStore, useEffect, useState } from "react";

const WATCH_KEY = "agora-watchlist";
const visitKey = (pid) => `agora-lastvisit-${pid}`;

function readIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(WATCH_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

// ── Watchlist external store ──────────────────────────────────────────────
let _watch = readIds();
const _listeners = new Set();

function _emit() {
  for (const l of _listeners) l();
}

function _subscribe(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

// Keep in sync with other tabs.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === WATCH_KEY) {
      _watch = readIds();
      _emit();
    }
  });
}

export function toggleWatch(id) {
  if (!id) return;
  const next = new Set(_watch);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  _watch = next;
  try {
    localStorage.setItem(WATCH_KEY, JSON.stringify([..._watch]));
  } catch {
    /* storage full / disabled — keep in-memory */
  }
  _emit();
}

/** Reactive watchlist. `_watch` reference is stable until a change, so this is cheap. */
export function useWatchlist() {
  const ids = useSyncExternalStore(_subscribe, () => _watch, () => _watch);
  return {
    ids,
    count: ids.size,
    has: (id) => ids.has(id),
    toggle: toggleWatch,
  };
}

// ── Last-visit ("what's new") ─────────────────────────────────────────────
/**
 * Returns the timestamp (ms) of the PREVIOUS visit to this project, or null on
 * first ever visit. Stamps "now" shortly after mount so the next visit compares
 * against this one. Use to badge items with `updated_at` newer than the return.
 */
export function usePreviousVisit(projectId) {
  const [prev, setPrev] = useState(null);
  useEffect(() => {
    if (!projectId) return;
    const key = visitKey(projectId);
    let stored = null;
    try {
      stored = localStorage.getItem(key);
    } catch {
      /* ignore */
    }
    setPrev(stored ? Number(stored) : null);
    const now = Date.now();
    const t = setTimeout(() => {
      try {
        localStorage.setItem(key, String(now));
      } catch {
        /* ignore */
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [projectId]);
  return prev;
}
