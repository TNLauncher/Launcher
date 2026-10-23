import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/lib/cx";
import { Icon } from "./Icon";
import s from "./Select.module.css";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface Props<T extends string> {
  value: T;
  options: SelectOption<NoInfer<T>>[];
  onChange(value: NoInfer<T>): void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  /** pill: rounded trigger for toolbars and docks */
  variant?: "default" | "pill";
  className?: string;
  style?: CSSProperties;
}

/** Select-only combobox: focus stays on the trigger, the list follows via aria-activedescendant. */
export function Select<T extends string>({ value, options, onChange, label, placeholder, disabled, variant = "default", className, style }: Props<T>) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ style: CSSProperties; up: boolean; host: Element }>();
  const current = options.find((o) => o.value === value);
  const off = disabled || !options.length;

  function show() {
    if (off || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const below = innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 220 && above > below;
    setPlace({
      up,
      // <dialog> sits in the top layer, so the list must live inside it to be visible
      host: btn.current.closest("dialog") ?? document.body,
      style: {
        left: r.left, minWidth: r.width, maxHeight: Math.min(320, up ? above : below),
        ...(up ? { bottom: innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      },
    });
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function pick(i: number) {
    setOpen(false);
    if (options[i].value !== value) onChange(options[i].value);
  }

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const scrolled = (e: Event) => { if (!list.current?.contains(e.target as Node)) setOpen(false); };
    const close = () => setOpen(false);
    addEventListener("pointerdown", outside, true);
    addEventListener("scroll", scrolled, true);
    addEventListener("resize", close);
    addEventListener("blur", close);
    return () => {
      removeEventListener("pointerdown", outside, true);
      removeEventListener("scroll", scrolled, true);
      removeEventListener("resize", close);
      removeEventListener("blur", close);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onKeyDown(e: KeyboardEvent) {
    const last = options.length - 1;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    const move = (i: number) => { e.preventDefault(); setActive(Math.min(last, Math.max(0, i))); };
    switch (e.key) {
      case "ArrowDown": return move(active + 1);
      case "ArrowUp": return move(active - 1);
      case "Home": case "PageUp": return move(0);
      case "End": case "PageDown": return move(last);
      case "Enter": case " ": e.preventDefault(); return pick(active);
      // preventDefault also stops an enclosing <dialog> from cancelling
      case "Escape": e.preventDefault(); e.stopPropagation(); return setOpen(false);
      case "Tab": return setOpen(false);
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const t = typed.current;
      t.text = now - t.at < 600 ? t.text + e.key.toLowerCase() : e.key.toLowerCase();
      t.at = now;
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(t.text));
      if (i >= 0) setActive(i);
    }
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        className={cx(s.select, variant === "pill" && s.pill, className)}
        style={style}
        disabled={off}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span className={cx(s.value, !current && s.placeholder)}>{current?.label ?? placeholder}</span>
        <Icon name="unfold_more" />
      </button>
      {open && place && createPortal(
        <ul
          ref={list}
          id={id}
          role="listbox"
          aria-label={label}
          className={cx(s.list, place.up && s.up)}
          style={place.style}
          onPointerDown={(e) => e.preventDefault()}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active || undefined}
              onPointerMove={() => i !== active && setActive(i)}
              onClick={() => pick(i)}
            >
              <Icon name="check" className={s.check} />
              <span>{o.label}</span>
              {o.hint && <span className={s.hint}>{o.hint}</span>}
            </li>
          ))}
        </ul>,
        place.host,
      )}
    </>
  );
}
