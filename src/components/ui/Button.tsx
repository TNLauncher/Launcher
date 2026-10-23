import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "./Icon";
import s from "./Button.module.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: main action · destructive: confirm a deletion · danger: stop/abort · link: inline text action · overlay: on top of imagery */
  variant?: "default" | "primary" | "destructive" | "danger" | "link" | "overlay";
  size?: "sm" | "md" | "lg";
  icon?: string;
  /** Swaps the icon for a spinner and disables the button. */
  loading?: boolean;
}

export function Button({ variant = "default", size = "md", icon, loading, className, disabled, type = "button", children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={cx(s.btn, s[variant], s[size], className)} disabled={disabled || loading} {...rest}>
      {loading ? <Icon name="progress_activity" spin /> : icon && <Icon name={icon} fill={variant === "primary" && size === "lg"} />}
      {children}
    </button>
  );
}
