import { cx } from "@/lib/cx";
import s from "./ProgressBar.module.css";

/** `value` in 0..1; omit it for an indeterminate sweep. */
export function ProgressBar({ value, className }: { value?: number; className?: string }) {
  const known = value != null;
  return (
    <div className={cx(s.bar, !known && s.indeterminate, className)} role="progressbar" aria-valuenow={known ? Math.round(value * 100) : undefined}>
      <div className={s.fill} style={known ? { transform: `scaleX(${value})` } : undefined} />
    </div>
  );
}
