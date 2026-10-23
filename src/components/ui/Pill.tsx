import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "./Icon";
import s from "./Pill.module.css";

interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pressed: boolean;
  icon?: string;
  count?: ReactNode;
}

/** Toggle chip for filters and segmented choices. */
export function Pill({ pressed, icon, count, className, type = "button", children, ...rest }: PillProps) {
  return (
    <button type={type} className={cx(s.pill, className)} aria-pressed={pressed} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
      {count != null && <span className={cx("mono", s.count)}>{count}</span>}
    </button>
  );
}

export function PillGroup({ label, wrap, className, children }: { label?: string; wrap?: boolean; className?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className={cx(s.group, wrap && s.wrap, className)}>
      {children}
    </div>
  );
}
