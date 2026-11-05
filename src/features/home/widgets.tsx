import type { ReactNode } from "react";
import type { PluginEntry, PluginWidget } from "@/api/sources";
import { usePlugins } from "@/hooks/useSource";
import { cx } from "@/lib/cx";
import { pluginBase } from "@/plugins/bridge";
import { PluginFrame } from "@/plugins/PluginHost";
import type { Instance, Slot, Span } from "@/types";
import { Hero } from "./Hero";
import { InstanceSpec } from "./InstanceSpec";
import { InstanceTiles } from "./InstanceTiles";
import { PatchNotes } from "./PatchNotes";
import { PlayerCard } from "./PlayerCard";
import { RecentWorlds } from "./RecentWorlds";
import s from "./home.module.css";

export interface Widget {
  id: string;
  title: string;
  icon: string;
  /** Width it gets when added. */
  span: Span;
  /** Nothing to show (e.g. no instance yet): falsy. Instance-bound widgets are keyed so a switch re-stages them. */
  render(inst: Instance | undefined): ReactNode;
}

const BUILTIN: Widget[] = [
  { id: "hero", title: "Instance", icon: "image", span: 8, render: (inst) => <Hero key={inst?.id} /> },
  { id: "player", title: "Player", icon: "person", span: 4, render: () => <PlayerCard /> },
  { id: "worlds", title: "Worlds", icon: "public", span: 4, render: (inst) => inst && <RecentWorlds key={inst.id} inst={inst} /> },
  { id: "spec", title: "Details", icon: "info", span: 4, render: (inst) => inst && <InstanceSpec key={inst.id} inst={inst} /> },
  { id: "news", title: "Patch notes", icon: "newspaper", span: 4, render: () => <PatchNotes /> },
  { id: "instances", title: "Instances", icon: "layers", span: 12, render: () => <InstanceTiles /> },
];

export const DEFAULT_HOME: Slot[] = BUILTIN.map(({ id, span }) => ({ id, span }));

/** Built-in widgets, then those of enabled plugins as `plugin:<plugin id>:<widget id>`. */
export function useWidgets(): Widget[] {
  const plugins = usePlugins().data ?? [];
  return [
    ...BUILTIN,
    ...plugins
      .filter((p) => p.enabled && !p.error)
      .flatMap((p) =>
        p.widgets.map((w): Widget => ({
          id: `plugin:${p.id}:${w.id}`,
          title: w.title,
          icon: w.icon,
          span: w.span,
          render: (inst) => <PluginWidgetFrame plugin={p} widget={w} inst={inst} />,
        }))
      ),
  ];
}

/** A plugin's widget in a sandboxed frame; `tn.context.instance` is the selected instance. */
function PluginWidgetFrame({ plugin, widget, inst }: { plugin: PluginEntry; widget: PluginWidget; inst: Instance | undefined }) {
  const query = inst ? `?instance=${encodeURIComponent(inst.id)}` : "";
  return (
    <div className={cx(s.cell, s.pluginWidget)}>
      {/* shortcut: the frame reloads on an instance switch, like instance tabs; push an event instead if widgets get heavy. */}
      <PluginFrame key={inst?.id} plugin={plugin.id} instances={plugin.permissions.instances} src={`${pluginBase}${plugin.id}/${widget.entry}${query}`}
        title={widget.title} className={s.pluginWidgetFrame} />
    </div>
  );
}
