import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { InstanceContent } from "@/features/content/InstanceContent";
import { loaderLabel } from "@/lib/format";
import { useLauncher, useRecentInstances } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";

/** Content of any instance, picked here; the same panes live on each instance's own page. */
export function ModsView() {
  const { selected } = useLauncher();
  const { openNewInstance } = useUi();
  const recent = useRecentInstances();
  const [pickedId, setPickedId] = useState<string>();

  const instance = useMemo(
    () => recent.find((i) => i.id === pickedId) ?? recent.find((i) => i.id === selected?.id) ?? recent[0],
    [recent, pickedId, selected]
  );

  if (!instance) {
    return (
      <section className="view">
        <EmptyState icon="extension_off" action={<button className="btn primary" onClick={openNewInstance}><Icon name="add" />Create instance</button>}>
          Create an instance first: mods, resource packs and shaders live inside one.
        </EmptyState>
      </section>
    );
  }

  return (
    <section className="view mods-view">
      <div className="mods-head">
        <Select
          label="Instance"
          className="mods-picker"
          value={instance.id}
          onChange={setPickedId}
          options={recent.map((i) => ({ value: i.id, label: i.name, hint: `${i.version} · ${loaderLabel(i)}` }))}
        />
      </div>
      <InstanceContent key={instance.id} instance={instance} />
    </section>
  );
}
