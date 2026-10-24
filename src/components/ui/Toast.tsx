import { useSyncExternalStore } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "./Icon";
import s from "./Toast.module.css";

type Tone = "success" | "info" | "critical";
interface Item { id: number; message: string; tone: Tone; icon: string; leaving?: boolean }

const ICON: Record<Tone, string> = { success: "check_circle", info: "info", critical: "error" };
const SHOWN_MS = 3200;
const EXIT_MS = 320;

// Module store: toasts can fire from contexts and async callbacks that outlive their component.
let items: Item[] = [];
let nextId = 0;
const subs = new Set<() => void>();
const set = (next: Item[]) => ((items = next), subs.forEach((f) => f()));

function dismiss(id: number) {
  set(items.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
  setTimeout(() => set(items.filter((t) => t.id !== id)), EXIT_MS);
}

/** Confirms an action that otherwise finishes silently. Errors stay inline where they happened. */
export function toast(message: string, tone: Tone = "success", icon = ICON[tone]) {
  const id = ++nextId;
  set([...items.slice(-2), { id, message, tone, icon }]);
  setTimeout(() => dismiss(id), SHOWN_MS);
}

export function Toaster() {
  const list = useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => items);
  return (
    <div className={s.stack} role="status" aria-live="polite">
      {list.map((t) => (
        // The slot collapses its height on exit, so the toasts above glide down instead of jumping.
        <div key={t.id} className={cx(s.slot, t.leaving && s.leaving)}>
          <div className={cx(s.toast, s[t.tone])} onClick={() => dismiss(t.id)}>
            <Icon name={t.icon} fill className={s.icon} />
            <span>{t.message}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
