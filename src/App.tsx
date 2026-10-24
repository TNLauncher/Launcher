import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useLayoutEffect, useRef } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Titlebar } from "@/components/layout/Titlebar";
import { Toaster } from "@/components/ui/Toast";
import { PluginHost } from "@/plugins/PluginHost";
import { PluginPage } from "@/plugins/PluginPage";
import { LauncherProvider } from "@/store/LauncherContext";
import { UiProvider, useUi } from "@/store/UiContext";
import { viewComponent } from "@/views";
import s from "@/components/layout/Shell.module.css";

const NewInstanceDialog = lazy(() => import("@/features/instances/NewInstanceDialog").then((m) => ({ default: m.NewInstanceDialog })));

function CurrentView({ view }: { view: Parameters<typeof viewComponent>[0] }) {
  const Current = viewComponent(view);
  return <Current />;
}

function Shell() {
  const { view, newInstanceOpen } = useUi();
  const [, plugin, page] = view.split(":");
  const main = useRef<HTMLElement>(null);
  // Each view opens at the top; the scroller itself persists so the old view stays up while the next one loads.
  // Layout effect: the new view paints already scrolled to the top.
  useLayoutEffect(() => {
    main.current?.scrollTo(0, 0);
  }, [view]);
  return (
    <>
      <Sidebar />
      <Titlebar />
      <main ref={main} className={s.main}>
        <Suspense>
          {page ? <PluginPage key={view} plugin={plugin} page={page} /> : <CurrentView view={view as Parameters<typeof viewComponent>[0]} />}
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
