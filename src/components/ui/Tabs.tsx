import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "./Icon";
import s from "./Tabs.module.css";

/** Underlined tab strip; the panel is the caller's `role="tabpanel"`. */
export function Tabs({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="tablist" aria-label={label} className={cx(s.tabs, className)}>
      {children}
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
