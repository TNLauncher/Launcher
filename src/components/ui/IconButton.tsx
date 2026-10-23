import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "./Icon";
import s from "./IconButton.module.css";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: string;
  /** Accessible name and tooltip. */
  label: string;
  variant?: "default" | "danger" | "overlay";
}

export function IconButton({ icon, label, variant = "default", className, type = "button", title, ...rest }: Props) {
  return (
    <button type={type} className={cx(s.btn, s[variant], className)} aria-label={label} title={title ?? label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}
