// The user's arrangement of Home widgets and sidebar items, kept in Settings.layout.
import { useMemo, useState, type DragEvent } from "react";
import { toast } from "@/components/ui";
import { errorMessage } from "@/lib/format";
import type { Layout, Slot, Span } from "@/types";
import { useLauncher } from "./LauncherContext";

export const SPANS: { span: Span; label: string }[] = [
  { span: 3, label: "Small" },
  { span: 4, label: "Medium" },
  { span: 6, label: "Half" },
  { span: 8, label: "Large" },
  { span: 12, label: "Full width" },
];

/** Sidebar items that cannot be hidden: without them there is no way back to Home or to this setting. */
export const PINNED_VIEWS = ["home", "settings"];

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const isSlot = (v: unknown): v is Slot =>
  !!v && typeof (v as Slot).id === "string" && SPANS.some((x) => x.span === (v as Slot).span);

/** settings.json can be edited by hand: keep what is well-formed, default the rest. */
export function parseLayout(raw: unknown): Layout {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sidebar = (r.sidebar && typeof r.sidebar === "object" ? r.sidebar : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const home = Array.isArray(r.home)
    ? r.home.filter((w): w is Slot => isSlot(w) && !seen.has(w.id) && !!seen.add(w.id)).map(({ id, span }) => ({ id, span }))
    : null;
  return { home, sidebar: { order: strings(sidebar.order), hidden: strings(sidebar.hidden) } };
}

export function useLayout(): Layout {
  const raw = useLauncher((st) => st.snapshot?.settings.layout);
  return useMemo(() => parseLayout(raw), [raw]);
}

export function saveLayout(layout: Layout) {
  const { snapshot, saveSettings } = useLauncher.getState();
  if (!snapshot) return;
  saveSettings({ ...snapshot.settings, layout }).catch((e) => toast(`Could not save the layout: ${errorMessage(e)}`, "critical"));
}

/** Sidebar items in the user's order; ones the order does not know (a new plugin page) follow in default order. */
export function arrange<T extends { view: string }>(items: T[], order: string[]): T[] {
  const rank = (v: string) => (order.includes(v) ? order.indexOf(v) : order.length);
  return [...items].sort((a, b) => rank(a.view) - rank(b.view));
}

export const move = <T,>(list: T[], from: number, to: number): T[] => {
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
};

/** Drag-to-reorder for a list: spread `props(i)` on each item. Drop on an item puts the dragged one in its place. */
export function useDragSort(onMove: (from: number, to: number) => void) {
  const [from, setFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return (i: number) => ({
    draggable: true,
    "data-dragging": from === i || undefined,
    "data-over": (over === i && from !== null && from !== i) || undefined,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      // WebKit starts a drag only with some data set.
      e.dataTransfer.setData("text/plain", "");
      setFrom(i);
    },
    onDragOver: (e: DragEvent) => {
      if (from === null) return;
      e.preventDefault();
      setOver(i);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (from !== null && from !== i) onMove(from, i);
    },
    onDragEnd: () => {
      setFrom(null);
      setOver(null);
    },
  });
}
