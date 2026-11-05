import { Button, Dialog, Icon, IconButton, Menu } from "@/components/ui";
import { cx } from "@/lib/cx";
import { SPANS } from "@/store/layout";
import type { Span } from "@/types";
import type { Widget } from "./widgets";
import s from "./home.module.css";

export function EditBar({ canAdd, onAdd, onReset, onDone }: { canAdd: boolean; onAdd(): void; onReset(): void; onDone(): void }) {
  return (
    <div className={s.editBar}>
      <p>Drag widgets to rearrange them. Changes save as you go.</p>
      <div className={s.editActions}>
        <Button icon="add" disabled={!canAdd} onClick={onAdd}>Add widget</Button>
        <Button onClick={onReset}>Reset</Button>
        <Button variant="primary" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

/** The veil over a slot while editing: its name, then move, width and remove. */
export function SlotTools(p: { title: string; span: Span; first: boolean; last: boolean; onMove(step: -1 | 1): void; onSpan(span: Span): void; onRemove(): void }) {
  return (
    <div className={s.slotTools}>
      <span className={s.slotTitle}>
        <Icon name="drag_indicator" />
        {p.title}
      </span>
      <div className={s.slotActions}>
        <IconButton icon="arrow_back" variant="overlay" label={`Move ${p.title} earlier`} disabled={p.first} onClick={() => p.onMove(-1)} />
        <IconButton icon="arrow_forward" variant="overlay" label={`Move ${p.title} later`} disabled={p.last} onClick={() => p.onMove(1)} />
        <Menu label={`Width of ${p.title}`} icon="aspect_ratio"
          items={SPANS.map((x) => ({ icon: x.span === p.span ? "check" : "", label: x.label, onSelect: () => p.onSpan(x.span) }))} />
        <IconButton icon="close" variant="overlay" label={`Remove ${p.title}`} onClick={p.onRemove} />
      </div>
    </div>
  );
}

/** Stands in while editing for a widget with nothing to show yet, so it can still be placed. */
export function Placeholder({ widget }: { widget: Widget }) {
  return (
    <div className={cx(s.cell, s.pane, s.placeholder)}>
      <Icon name={widget.icon} />
      <strong>{widget.title}</strong>
      <span>Shows once an instance is selected</span>
    </div>
  );
}

export function AddWidgetDialog({ open, widgets, onAdd, onClose }: { open: boolean; widgets: Widget[]; onAdd(w: Widget): void; onClose(): void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Add widget" actions={<Button onClick={onClose}>Cancel</Button>}>
      {widgets.length ? (
        <ul className={s.widgetList}>
          {widgets.map((w) => (
            <li key={w.id}>
              <button type="button" className={s.widgetOption} onClick={() => onAdd(w)}>
                <Icon name={w.icon} />
                {w.title}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={s.widgetEmpty}>Every widget is already on Home. Plugins can add more.</p>
      )}
    </Dialog>
  );
}
