import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "./Icon";
import s from "./Tabs.module.css";

/** Underlined tab strip; the panel is the caller's `role="tabpanel"`. */
export function Tabs({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  // One underline that slides to the selected tab. Measured after every render (tabs change label/count),
  // written straight to the DOM; the first placement skips the transition so it doesn't fly in from the left.
  useLayoutEffect(() => {
    const tab = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    const el = line.current;
    if (!el) return;
    el.hidden = !tab;
    if (!tab) return;
    el.style.width = `${tab.offsetWidth - 16}px`;
    el.style.transform = `translateX(${tab.offsetLeft + 8}px)`;
    if (!el.dataset.ready) requestAnimationFrame(() => (el.dataset.ready = "1"));
  });
  return (
    <div role="tablist" aria-label={label} ref={list} className={cx(s.tabs, className)}>
      {children}
      <span ref={line} className={s.line} aria-hidden="true" />
    </div>
  );
}

interface TabProps {
  selected: boolean;
  onSelect(): void;
  icon?: string;
  count?: ReactNode;
  children: ReactNode;
}

export function Tab({ selected, onSelect, icon, count, children }: TabProps) {
  return (
    <button type="button" role="tab" className={s.tab} aria-selected={selected} onClick={onSelect}>
      {icon && <Icon name={icon} />}
      {children}
      {count != null && <span className={cx("mono", s.count)}>{count}</span>}
    </button>
  );
}
