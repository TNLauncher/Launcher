import type { ReactNode } from "react";
import { Icon } from "./Icon";
import s from "./EmptyState.module.css";

export function EmptyState({ icon, children, action }: { icon: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      <Icon name={icon} />
      <span>{children}</span>
      {action}
    </div>
  );
}
