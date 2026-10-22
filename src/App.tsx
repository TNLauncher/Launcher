import { lazy, Suspense, type ComponentType } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Titlebar } from "@/components/layout/Titlebar";
import { HomeView } from "@/features/home/HomeView";
import { LauncherProvider } from "@/store/LauncherContext";
import { UiProvider, useUi, type View } from "@/store/UiContext";
import "@/components/layout/layout.css";

// Home is the first screen and stays in the main chunk; the rest load on first visit.
const VIEWS: Record<View, ComponentType> = {
  home: HomeView,
  instances: lazy(() => import("@/features/instances/InstancesView").then((m) => ({ default: m.InstancesView }))),
  mods: lazy(() => import("@/features/mods/ModsView").then((m) => ({ default: m.ModsView }))),
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
      <main>
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

export function App() {
  return (
    <LauncherProvider>
      <UiProvider>
        <Shell />
      </UiProvider>
    </LauncherProvider>
  );
}
