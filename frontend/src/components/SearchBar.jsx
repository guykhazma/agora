export default function SearchBar({ value, onChange }) {
  return (
    <input
      type="search"
      placeholder="Search proposals..."
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 min-w-[200px] max-w-sm bg-white/90 dark:bg-gray-900/90 border border-gray-200 dark:border-gray-600 rounded-xl px-3.5 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm focus:outline-none focus:border-agora-400 focus:ring-2 focus:ring-agora-500/30 transition-shadow"
    />
  );
}
