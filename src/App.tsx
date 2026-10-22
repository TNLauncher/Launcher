import { Sidebar } from "@/components/layout/Sidebar";
import { Titlebar } from "@/components/layout/Titlebar";
import { HomeView } from "@/features/home/HomeView";
import { InstancesView } from "@/features/instances/InstancesView";
import { NewInstanceDialog } from "@/features/instances/NewInstanceDialog";
import { ModsView } from "@/features/mods/ModsView";
import { SettingsView } from "@/features/settings/SettingsView";
import { LauncherProvider } from "@/store/LauncherContext";
import { UiProvider, useUi, type View } from "@/store/UiContext";
import "@/components/layout/layout.css";

const VIEWS: Record<View, () => React.JSX.Element> = {
  home: HomeView,
  instances: InstancesView,
  mods: ModsView,
  settings: SettingsView,
};

function Shell() {
  const { view } = useUi();
  const Current = VIEWS[view];
  return (
    <>
      <Sidebar />
      <Titlebar />
      <main>
        <Current />
      </main>
      <NewInstanceDialog />
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
