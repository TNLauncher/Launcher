import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, type ComponentType } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Titlebar } from "@/components/layout/Titlebar";
import { Toaster } from "@/components/ui/Toast";
import { HomeView } from "@/features/home/HomeView";
import { PluginHost } from "@/plugins/PluginHost";
import { PluginPage } from "@/plugins/PluginPage";
import { LauncherProvider } from "@/store/LauncherContext";
import { UiProvider, useUi, type View } from "@/store/UiContext";
import s from "@/components/layout/Shell.module.css";

// Home is the first screen and stays in the main chunk; the rest load on first visit.
const VIEWS: Record<Exclude<View, `plugin:${string}`>, ComponentType> = {
  home: HomeView,
  profiles: lazy(() => import("@/features/profiles/ProfilesView").then((m) => ({ default: m.ProfilesView }))),
  instances: lazy(() => import("@/features/instances/InstancesView").then((m) => ({ default: m.InstancesView }))),
  modpacks: lazy(() => import("@/features/modpacks/ModpacksView").then((m) => ({ default: m.ModpacksView }))),
  mods: lazy(() => import("@/features/mods/ModsView").then((m) => ({ default: m.ModsView }))),
  console: lazy(() => import("@/features/console/ConsoleView").then((m) => ({ default: m.ConsoleView }))),
  settings: lazy(() => import("@/features/settings/SettingsView").then((m) => ({ default: m.SettingsView }))),
};
const NewInstanceDialog = lazy(() => import("@/features/instances/NewInstanceDialog").then((m) => ({ default: m.NewInstanceDialog })));

function CurrentView({ view }: { view: keyof typeof VIEWS }) {
  const Current = VIEWS[view];
  return <Current />;
}

function Shell() {
  const { view, newInstanceOpen } = useUi();
  const [, plugin, page] = view.split(":");
  return (
    <>
      <Sidebar />
      <Titlebar />
      {/* Keyed: each view opens scrolled to the top and replays its entrance. */}
      <main key={view} className={s.main}>
        <Suspense>
          {page ? <PluginPage key={view} plugin={plugin} page={page} /> : <CurrentView view={view as keyof typeof VIEWS} />}
        </Suspense>
      </main>
      <PluginHost />
      <Toaster />
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
