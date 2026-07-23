/**
 * Tiny dependency-free hash router for deep-linking / shareable URLs.
 *
 * Route shape:
 *   #/project/:projectId/:tab?item=:proposalId&init=:initiativeId
 *
 * A single external store (window's `hashchange`) is shared by every consumer via
 * useSyncExternalStore, so App, Dashboard and HomeView can each read/patch the
 * route independently without prop-drilling. Patches merge against the *current*
 * parsed hash, so concurrent writers stay consistent. Unknown ids are the caller's
 * problem to ignore — this layer only parses/serializes.
 */
import { useSyncExternalStore, useMemo, useCallback } from "react";

/** Parse the live hash into a plain route object. */
export function parseHash(raw = window.location.hash) {
  const h = (raw || "").replace(/^#/, "");
  const [path = "", queryStr = ""] = h.split("?");
  const parts = path.split("/").filter(Boolean); // ["project", pid, tab]
  let projectId = null;
  let tab = null;
  if (parts[0] === "project") {
    projectId = parts[1] ? safeDecode(parts[1]) : null;
    tab = parts[2] ? safeDecode(parts[2]) : null;
  }
  const q = new URLSearchParams(queryStr);
  return {
    projectId,
    tab,
    item: q.get("item") || null,
    init: q.get("init") || null,
  };
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Serialize a route object back into a hash string (leading `#`). */
export function buildHash({ projectId, tab, item, init } = {}) {
  if (!projectId) return "#/";
  let path = `/project/${encodeURIComponent(projectId)}`;
  if (tab) path += `/${encodeURIComponent(tab)}`;
  const q = new URLSearchParams();
  if (item) q.set("item", item);
  if (init) q.set("init", init);
  const qs = q.toString();
  return `#${path}${qs ? `?${qs}` : ""}`;
}

function subscribe(cb) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

function getSnapshot() {
  return window.location.hash;
}

/**
 * Reactive hash route. Returns `[route, setRoute]`.
 * `setRoute(patch, { replace })` merges `patch` onto the current route.
 * `replace: true` swaps history in place (no new back-stack entry) — use for the
 * initial normalization so Back doesn't land on an empty hash.
 */
export function useHashRoute() {
  const hash = useSyncExternalStore(subscribe, getSnapshot, () => "");
  const route = useMemo(() => parseHash(hash), [hash]);

  const setRoute = useCallback((patch, { replace = false } = {}) => {
    const next = { ...parseHash(), ...patch };
    const nextHash = buildHash(next);
    if (nextHash === window.location.hash) return;
    if (replace) {
      history.replaceState(null, "", nextHash);
      // replaceState doesn't emit hashchange — notify subscribers manually.
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else {
      window.location.hash = nextHash; // emits hashchange, pushes history entry
    }
  }, []);

  return [route, setRoute];
}
