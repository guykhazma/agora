import { digestHighlights } from "../lib/evidence";

export default function DigestHighlights({ digest }) {
  const highlights = digestHighlights(digest);
  if (!highlights.length) return null;
  return (
    <ul className="space-y-2 md:max-w-xs md:border-l border-gray-200/80 dark:border-gray-700 md:pl-5">
      {highlights.map((h, i) => (
        <li key={i} className="text-xs text-gray-600 dark:text-gray-400 leading-snug">
          <p>{h.text}</p>
          {h.sources.length > 0 && (
            <span className="flex flex-wrap gap-x-2 mt-1">
              {h.sources.map((source, j) => (
                <a key={source.id || j} href={source.url} target="_blank" rel="noreferrer"
                  title={source.title} aria-label={`Source ${j + 1}: ${source.title}`}
                  className="text-agora-700 dark:text-agora-300 underline focus-ring">
                  Source {j + 1} ↗
                </a>
              ))}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
