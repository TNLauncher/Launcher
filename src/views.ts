import { lazy, type ComponentType } from "react";
import { HomeView } from "@/features/home/HomeView";
import type { View } from "@/store/UiContext";

type Page = Exclude<View, `plugin:${string}`>;
type Lazy = Exclude<Page, "home">;

// Home is the first screen and stays in the main chunk; the rest load on first visit (or hover, see preloadView).
const LOADERS: Record<Lazy, () => Promise<ComponentType>> = {
  profiles: () => import("@/features/profiles/ProfilesView").then((m) => m.ProfilesView),
  instances: () => import("@/features/instances/InstancesView").then((m) => m.InstancesView),
  modpacks: () => import("@/features/modpacks/ModpacksView").then((m) => m.ModpacksView),
  mods: () => import("@/features/mods/ModsView").then((m) => m.ModsView),
  console: () => import("@/features/console/ConsoleView").then((m) => m.ConsoleView),
  settings: () => import("@/features/settings/SettingsView").then((m) => m.SettingsView),
};

const isLazy = (v: View): v is Lazy => v in LOADERS;
// Resolved components, so a preloaded view renders synchronously (a view transition snapshots one frame).
const loaded: Partial<Record<Page, ComponentType>> = { home: HomeView };
const fallback = Object.fromEntries(Object.entries(LOADERS).map(([k, load]) => [k, lazy(() => load().then((c) => ({ default: c })))]));

/** Fetches a view's chunk; resolves once it can render without suspending. import() caches, so repeats are free. */
export function preloadView(view: View): Promise<void> {
  if (!isLazy(view) || loaded[view]) return Promise.resolve();
  return LOADERS[view]().then((c) => void (loaded[view] = c));
}

export function viewComponent(view: Page): ComponentType {
  return loaded[view] ?? fallback[view];
}
