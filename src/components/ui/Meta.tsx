import { Fragment, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import s from "./Meta.module.css";

/** Muted secondary line; falsy items are skipped, the rest are joined with bullets. */
export function Meta({ items, small, className }: { items: ReactNode[]; small?: boolean; className?: string }) {
  const shown = items.filter((i) => i !== null && i !== undefined && i !== false && i !== "");
  return (
    <div className={cx(s.meta, small && s.small, className)}>
      {shown.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && <span className={s.sep}>•</span>}
          {item}
        </Fragment>
      ))}
    </div>
  );
}
