import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function EmptyState({ icon, children, action }: { icon: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <span>{children}</span>
      {action}
    </div>
  );
}
