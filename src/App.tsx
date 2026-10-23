import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, type ComponentType } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Titlebar } from "@/components/layout/Titlebar";
import { HomeView } from "@/features/home/HomeView";
import { LauncherProvider } from "@/store/LauncherContext";
import { UiProvider, useUi, type View } from "@/store/UiContext";
import s from "@/components/layout/Shell.module.css";

// Home is the first screen and stays in the main chunk; the rest load on first visit.
const VIEWS: Record<View, ComponentType> = {
  home: HomeView,
  instances: lazy(() => import("@/features/instances/InstancesView").then((m) => ({ default: m.InstancesView }))),
  modpacks: lazy(() => import("@/features/modpacks/ModpacksView").then((m) => ({ default: m.ModpacksView }))),
  mods: lazy(() => import("@/features/mods/ModsView").then((m) => ({ default: m.ModsView }))),
  console: lazy(() => import("@/features/console/ConsoleView").then((m) => ({ default: m.ConsoleView }))),
  settings: lazy(() => import("@/features/settings/SettingsView").then((m) => ({ default: m.SettingsView }))),
};
const NewInstanceDialog = lazy(() => import("@/features/instances/NewInstanceDialog").then((m) => ({ default: m.NewInstanceDialog })));

function Shell() {
  const { view, newInstanceOpen } = useUi();
  const Current = VIEWS[view];
  return (
    <>
      <Sidebar />
      <Titlebar />
      <main className={s.main}>
        <Suspense>
          <Current />
        </Suspense>
      </main>
      {newInstanceOpen && (
        <Suspense>
          <NewInstanceDialog />
        </Suspense>
      )}
    </>
  );
}

// Remote catalog data (content sources): cached for the session, refetched only when stale.
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60_000, retry: 1, refetchOnWindowFocus: false } } });

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LauncherProvider>
        <UiProvider>
          <Shell />
        </UiProvider>
      </LauncherProvider>
    </QueryClientProvider>
  );
}
