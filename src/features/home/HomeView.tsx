import { useState } from "react";
import { View } from "@/components/layout/View";
import { Button } from "@/components/ui";
import { useChanged } from "@/hooks/useChanged";
import { cx } from "@/lib/cx";
import { useSelectedInstance } from "@/store/LauncherContext";
import { move, saveLayout, useDragSort, useLayout } from "@/store/layout";
import type { Slot } from "@/types";
import { LaunchDock } from "./LaunchDock";
import { AddWidgetDialog, EditBar, Placeholder, SlotTools } from "./LayoutEditor";
import { DEFAULT_HOME, useWidgets } from "./widgets";
import s from "./home.module.css";

export function HomeView() {
  const inst = useSelectedInstance();
  // Only a real switch re-stages, never opening Home.
  const restage = useChanged(inst?.id);
  const layout = useLayout();
  const widgets = useWidgets();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const slots = layout.home ?? DEFAULT_HOME;
  // Slots of widgets that are gone (plugin off) stay saved, so turning the plugin back on puts them back in place.
  const save = (home: Slot[] | null) => saveLayout({ ...layout, home });
  const drag = useDragSort((from, to) => save(move(slots, from, to)));
  const hidden = widgets.filter((w) => !slots.some((x) => x.id === w.id));

  return (
    <View dock className={s.home}>
      {editing && <EditBar canAdd={hidden.length > 0} onAdd={() => setAdding(true)} onReset={() => save(null)} onDone={() => setEditing(false)} />}
      <div className={cx(s.bento, restage && s.restage)}>
        {slots.map((slot, i) => {
          const w = widgets.find((x) => x.id === slot.id);
          const body = w?.render(inst);
          if (!w || (!body && !editing)) return null;
          return (
            // Same element either way, so entering edit mode does not remount the widget.
            <div key={slot.id} className={s.slot} data-span={slot.span} {...(editing && drag(i))}>
              {body || <Placeholder widget={w} />}
              {editing && (
                <SlotTools title={w.title} span={slot.span} first={i === 0} last={i === slots.length - 1}
                  onMove={(step) => save(move(slots, i, i + step))}
                  onSpan={(span) => save(slots.map((x) => (x.id === slot.id ? { ...x, span } : x)))}
                  onRemove={() => save(slots.filter((x) => x.id !== slot.id))} />
              )}
            </div>
          );
        })}
      </div>
      {!editing && (
        <div className={s.customize}>
          <Button variant="link" icon="dashboard_customize" onClick={() => setEditing(true)}>Customize Home</Button>
        </div>
      )}
      <LaunchDock />
      <AddWidgetDialog open={adding} widgets={hidden} onClose={() => setAdding(false)}
        onAdd={(w) => {
          save([...slots, { id: w.id, span: w.span }]);
          setAdding(false);
        }} />
    </View>
  );
}
