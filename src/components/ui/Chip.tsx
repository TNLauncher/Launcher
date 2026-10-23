import type { HTMLAttributes } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "./Icon";
import s from "./Chip.module.css";

interface Props extends HTMLAttributes<HTMLSpanElement> {
  /** default: value (mono) · tag: version · ghost: category · warn / accent: status */
  variant?: "default" | "tag" | "ghost" | "warn" | "accent";
  icon?: string;
  spin?: boolean;
}

export function Chip({ variant = "default", icon, spin, className, children, ...rest }: Props) {
  return (
    <span className={cx(s.chip, s[variant], className)} {...rest}>
      {icon && <Icon name={icon} spin={spin} />}
      {children}
    </span>
  );
}
