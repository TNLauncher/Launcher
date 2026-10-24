import { useMemo, useState } from "react";
import { View } from "@/components/layout/View";
import { Button, EmptyState, Select } from "@/components/ui";
import { InstanceContent } from "@/features/content/InstanceContent";
import { loaderLabel } from "@/lib/format";
import { useRecentInstances, useSelectedInstance } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import s from "./mods.module.css";

/** Content of any instance, picked here; the same panes live on each instance's own page. */
export function ModsView() {
  const selected = useSelectedInstance();
  const openNewInstance = useUi((st) => st.openNewInstance);
  const recent = useRecentInstances();
  const [pickedId, setPickedId] = useState<string>();

  const instance = useMemo(
    () => recent.find((i) => i.id === pickedId) ?? recent.find((i) => i.id === selected?.id) ?? recent[0],
    [recent, pickedId, selected]
  );

  if (!instance) {
    return (
      <View>
        <EmptyState icon="extension_off" action={<Button variant="primary" icon="add" onClick={openNewInstance}>Create instance</Button>}>
          Create an instance first: mods, resource packs and shaders live inside one.
        </EmptyState>
      </View>
    );
  }

  return (
    <View className={s.mods}>
      <div className={s.head}>
        <Select
          label="Instance"
          className={s.picker}
          value={instance.id}
          onChange={setPickedId}
          options={recent.map((i) => ({ value: i.id, label: i.name, hint: `${i.version} · ${loaderLabel(i)}` }))}
        />
      </div>
      <InstanceContent key={instance.id} instance={instance} />
    </View>
  );
}
