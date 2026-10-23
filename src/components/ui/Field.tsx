import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import s from "./Field.module.css";

interface FieldProps {
  label: ReactNode;
  /** Wraps in <label> so a single control gets its name; pass false for groups. */
  asLabel?: boolean;
  className?: string;
  children: ReactNode;
}

/** Caption above a control. */
export function Field({ label, asLabel = true, className, children }: FieldProps) {
  const Tag = asLabel ? "label" : "div";
  return (
    <Tag className={cx(s.field, className)}>
      <span className={s.label}>{label}</span>
      {children}
    </Tag>
  );
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange(checked: boolean): void; children: ReactNode }) {
  return (
    <label className={s.check}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}
