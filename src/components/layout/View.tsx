import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import s from "./View.module.css";

/** Page root inside <main>; `dock` reserves room for the fixed launch dock. */
export function View({ dock, className, children }: { dock?: boolean; className?: string; children?: ReactNode }) {
  return <section className={cx(s.view, dock && s.dock, className)}>{children}</section>;
}
