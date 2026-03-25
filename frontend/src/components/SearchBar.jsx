export default function SearchBar({
  id,
  value,
  onChange,
  placeholder = "Search…",
  onSubmit,
  className = "",
}) {
  return (
    <input
      id={id}
      type="search"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmit?.();
      }}
      autoComplete="off"
      className={`flex-1 min-w-[180px] max-w-xl bg-white/90 dark:bg-gray-900/90 border border-gray-200 dark:border-gray-600 rounded-xl px-3.5 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm focus:outline-none focus:border-agora-400 focus:ring-2 focus:ring-agora-500/30 transition-shadow ${className}`}
    />
  );
}
