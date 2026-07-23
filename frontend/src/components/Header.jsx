import { AgoraLogo, GitHubIcon } from "./Icons";
import { useTheme } from "../App";

function SunIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
    </svg>
  );
}

function MoonIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
    </svg>
  );
}

export default function Header({ onHome }) {
  const { dark, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-30 border-b border-gray-200/80 dark:border-gray-800/80 bg-white/80 dark:bg-gray-950/80 backdrop-blur-md backdrop-saturate-150 shadow-sm shadow-gray-900/5 dark:shadow-none">
      <div className="max-w-screen-xl mx-auto px-6 h-14 flex items-center gap-4">
        <button
          onClick={onHome}
          className="flex items-center gap-2.5 rounded-lg -ml-1 pl-1 pr-2 py-1 hover:bg-gray-100/80 dark:hover:bg-gray-800/60 transition-colors focus-ring"
          aria-label="Go to overview"
        >
          <AgoraLogo className="w-6 h-6 text-agora-500" />
          <span className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Agōra</span>
        </button>

        <span className="text-gray-300 dark:text-gray-700 hidden sm:block">·</span>
        <span className="text-gray-500 dark:text-gray-400 text-sm hidden sm:block">
          Your open-source town hall
        </span>

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={toggle}
            className="p-1.5 rounded text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus-ring"
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {dark ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
          </button>
          <a
            href="https://github.com/guykhazma/agora"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm transition-colors"
          >
            <GitHubIcon className="w-4 h-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </div>
    </header>
  );
}
