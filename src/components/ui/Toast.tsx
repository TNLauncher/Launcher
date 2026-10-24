import { create } from "zustand";
import { cx } from "@/lib/cx";
import { Icon } from "./Icon";
import s from "./Toast.module.css";

type Tone = "success" | "info" | "critical";
interface Item { id: number; message: string; tone: Tone; icon: string; leaving?: boolean }

const ICON: Record<Tone, string> = { success: "check_circle", info: "info", critical: "error" };
const SHOWN_MS = 3200;
const EXIT_MS = 320;

// Module store: toasts can fire from stores and async callbacks that outlive their component.
const useToastStore = create<{ items: Item[] }>(() => ({ items: [] }));
let nextId = 0;

function dismiss(id: number) {
  useToastStore.setState((st) => ({ items: st.items.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }));
  setTimeout(() => useToastStore.setState((st) => ({ items: st.items.filter((t) => t.id !== id) })), EXIT_MS);
}

/** Confirms an action that otherwise finishes silently. Errors stay inline where they happened; critical is the catch-all for ones nobody handled. */
export function toast(message: string, tone: Tone = "success", icon = ICON[tone]) {
  const id = ++nextId;
  useToastStore.setState((st) => ({ items: [...st.items.slice(-2), { id, message, tone, icon }] }));
  // Errors take longer to read and may need copying down.
  setTimeout(() => dismiss(id), tone === "critical" ? SHOWN_MS * 2 : SHOWN_MS);
}

export function Toaster() {
  const list = useToastStore((st) => st.items);
  return (
    <div className={s.stack} role="status" aria-live="polite">
      {list.map((t) => (
        // The slot collapses its height on exit, so the toasts above glide down instead of jumping.
        <div key={t.id} className={cx(s.slot, t.leaving && s.leaving)}>
          <div className={cx(s.toast, s[t.tone])} onClick={() => dismiss(t.id)}>
            <Icon name={t.icon} fill className={s.icon} />
            <span className={s.text}>{t.message}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
