import { useWatchlist } from "../lib/prefs";

/**
 * Watchlist star toggle. Works for any id string — proposals *or* initiatives
 * (the watchlist store is id-agnostic). Stops propagation so it never triggers
 * an enclosing card/detail click. Pass `id` and it wires itself to the store;
 * or pass explicit `starred`/`toggle` to reuse a parent's hook instance.
 */
export default function StarButton({ id, starred, toggle, className = "", label = "watchlist" }) {
  const store = useWatchlist();
  const isStarred = starred ?? store.has(id);
  const doToggle = toggle ?? store.toggle;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); doToggle(id); }}
      aria-pressed={isStarred}
      aria-label={isStarred ? `Remove from ${label}` : `Add to ${label}`}
      title={isStarred ? `Remove from ${label}` : `Add to ${label}`}
      className={`flex-shrink-0 leading-none px-0.5 rounded focus-ring transition-colors ${
        isStarred ? "text-amber-400" : "text-gray-300 dark:text-gray-600 hover:text-amber-400"
      } ${className}`}
    >
      ★
    </button>
  );
}
