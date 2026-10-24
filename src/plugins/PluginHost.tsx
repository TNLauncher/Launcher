import { useEffect, useRef } from "react";
import { usePlugins } from "@/hooks/useSource";
import { attachFrame, pluginBase, usePluginRevision } from "./bridge";

/** Hidden frames running each enabled plugin's `main`. */
export function PluginHost() {
  const plugins = usePlugins().data ?? [];
  return (
    <>
      {plugins
        .filter((p) => p.enabled && !p.error)
        .map((p) => (
          <PluginFrame key={p.id} plugin={p.id} instances={p.permissions.instances} background src={`${pluginBase}${p.id}/__tn/background.html`} title={`${p.name} plugin`} hidden />
        ))}
    </>
  );
}

/** A sandboxed plugin frame: scripts only, opaque origin, so no access to this window or Tauri. */
export function PluginFrame(p: { plugin: string; instances: boolean; background?: boolean; src: string; title: string; hidden?: boolean; className?: string }) {
  const rev = usePluginRevision();
  const ref = useRef<HTMLIFrameElement>(null);
  const { plugin, instances, background = false } = p;
  useEffect(() => {
    const win = ref.current?.contentWindow;
    return win ? attachFrame(win, plugin, background, instances) : undefined;
  }, [plugin, background, instances, rev]);
  return <iframe key={rev} ref={ref} src={p.src} title={p.title} sandbox="allow-scripts" hidden={p.hidden} className={p.className} />;
}
