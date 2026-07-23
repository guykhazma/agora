import { useEffect, useState } from "react";

/**
 * Returns `value` after it has stopped changing for `delay` ms. Used to keep the
 * global search input snappy while deferring the full-corpus filter/re-render.
 */
export function useDebouncedValue(value, delay = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
