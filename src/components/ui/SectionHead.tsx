import type { ReactNode } from "react";
import s from "./SectionHead.module.css";

export function SectionHead({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.head}>
      <h2>{title}</h2>
      {action}
    </div>
  );
}
