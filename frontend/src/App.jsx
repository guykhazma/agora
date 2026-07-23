import { useState, useEffect, createContext, useContext } from "react";
import { fetchProjects } from "./lib/data";
import { useHashRoute } from "./lib/useHashRoute";
import Header from "./components/Header";
import ProjectSelector from "./components/ProjectSelector";
import Dashboard from "./components/Dashboard";
import EmptyState from "./components/EmptyState";

export const ThemeContext = createContext({ dark: false, toggle: () => {} });
export function useTheme() { return useContext(ThemeContext); }

export default function App() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [dark, setDark] = useState(
    () => localStorage.getItem("agora-theme") === "dark"
  );
  const [route, setRoute] = useHashRoute();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("agora-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    fetchProjects()
      .then((ps) => setProjects(ps))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [loadAttempt]);

  // The active project is whatever the hash points at, if it's a known project.
  const activeProject = projects.find((p) => p.id === route.projectId) || null;
  const activeProjectId = activeProject?.id || null;

  // Normalize the URL to the first project when the hash names no/unknown project.
  useEffect(() => {
    if (projects.length > 0 && !activeProject) {
      setRoute(
        { projectId: projects[0].id, tab: null, item: null, init: null },
        { replace: true }
      );
    }
  }, [projects, activeProject, setRoute]);

  return (
    <ThemeContext.Provider value={{ dark, toggle: () => setDark((d) => !d) }}>
      <div className="min-h-screen flex flex-col">
        <Header onHome={() => setRoute({ tab: "home", item: null, init: null })} />

        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 py-20 fade-in">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-agora-400 to-indigo-500 opacity-90 shadow-lg shadow-agora-500/20" />
              <div className="space-y-2">
                <div className="h-2.5 w-36 skeleton" />
                <div className="h-2 w-24 skeleton opacity-70" />
              </div>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading projects…</p>
          </div>
        )}
        {error && (
          <div className="flex-1 flex items-center justify-center px-6 py-16 fade-in">
            <div className="max-w-md w-full rounded-2xl border border-red-200/80 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 px-6 py-5 text-center shadow-sm">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200">Couldn&apos;t load projects</p>
              <p className="text-xs text-red-600/90 dark:text-red-300/80 mt-2 leading-relaxed break-words">{error}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                Check that <code className="text-[11px] bg-white/80 dark:bg-gray-900/80 px-1 rounded">public/data</code> exists and <code className="text-[11px] bg-white/80 dark:bg-gray-900/80 px-1 rounded">projects.json</code> is reachable.
              </p>
              <button
                type="button"
                onClick={() => setLoadAttempt((n) => n + 1)}
                className="mt-4 text-sm font-medium text-white bg-red-600 hover:bg-red-500 dark:bg-red-700 dark:hover:bg-red-600 px-4 py-2 rounded-lg transition-colors focus-ring"
              >
                Retry
              </button>
            </div>
          </div>
        )}
        {!loading && !error && projects.length === 0 && <EmptyState />}

        {!loading && !error && projects.length > 0 && (
          <main className="flex-1 max-w-screen-xl mx-auto w-full px-6 py-8">
            <ProjectSelector
              projects={projects}
              activeId={activeProjectId}
              onChange={(id) => setRoute({ projectId: id, tab: null, item: null, init: null })}
            />
            {activeProject && (
              <Dashboard
                project={activeProject}
                key={activeProject.id}
              />
            )}
          </main>
        )}
      </div>
    </ThemeContext.Provider>
  );
}
