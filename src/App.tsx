import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useLayoutEffect, useRef } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Sidebar } from "@/components/layout/Sidebar";
import { Titlebar } from "@/components/layout/Titlebar";
import { Toaster } from "@/components/ui/Toast";
import { PluginHost } from "@/plugins/PluginHost";
import { PluginPage } from "@/plugins/PluginPage";
import { LauncherProvider } from "@/store/LauncherContext";
import { registerScroller, savedScroll, UiProvider, useRouteKey, useUi } from "@/store/UiContext";
import { viewComponent } from "@/views";
import s from "@/components/layout/Shell.module.css";

const NewInstanceDialog = lazy(() => import("@/features/instances/NewInstanceDialog").then((m) => ({ default: m.NewInstanceDialog })));

function CurrentView({ view }: { view: Parameters<typeof viewComponent>[0] }) {
  const Current = viewComponent(view);
  return <Current />;
}

function Shell() {
  const { route, newInstanceOpen } = useUi();
  const { view } = route;
  const key = useRouteKey();
  const [, plugin, page] = view.split(":");
  const main = useRef<HTMLElement>(null);
  // New screens open at the top, Back/Forward land where the screen was left; the scroller itself persists so
  // the old view stays up while the next one loads. Layout effect: the screen paints already at its position.
  useLayoutEffect(() => {
    registerScroller(main.current);
    main.current?.scrollTo(0, savedScroll(key));
  }, [key]);
  return (
    <>
      <Sidebar />
      <Titlebar />
      <main ref={main} className={s.main}>
        {/* Keyed by view: a crashed screen resets as soon as you navigate away. */}
        <ErrorBoundary key={view}>
          <Suspense>
            {page ? <PluginPage key={view} plugin={plugin} page={page} /> : <CurrentView view={view as Parameters<typeof viewComponent>[0]} />}
          </Suspense>
        </ErrorBoundary>
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
    <ErrorBoundary full>
      <QueryClientProvider client={queryClient}>
        <LauncherProvider>
          <UiProvider>
            <Shell />
          </UiProvider>
        </LauncherProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
