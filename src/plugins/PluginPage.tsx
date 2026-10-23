import { View } from "@/components/layout/View";
import { EmptyState } from "@/components/ui";
import { usePlugins } from "@/hooks/useSource";
import { pluginBase } from "./bridge";
import { PluginFrame } from "./PluginHost";
import s from "./plugins.module.css";

/** A sidebar page contributed by a plugin: its HTML in a sandboxed frame. */
export function PluginPage({ plugin, page }: { plugin: string; page: string }) {
  const p = usePlugins().data?.find((x) => x.id === plugin && x.enabled);
  const spec = p?.pages.find((x) => x.id === page);
  if (!p || !spec) return <View><EmptyState icon="extension_off">This plugin page is not available.</EmptyState></View>;
  return (
    <View className={s.page}>
      <PluginFrame key={`${plugin}/${page}`} plugin={plugin} instances={p.permissions.instances} src={`${pluginBase}${plugin}/${spec.entry}`} title={spec.title} className={s.frame} />
    </View>
  );
}
