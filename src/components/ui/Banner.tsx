import { Icon } from "./Icon";
import s from "./Banner.module.css";

interface Props {
  message: string;
  onRetry?(): void;
  onDismiss?(): void;
}

/** Inline error with optional Retry / Dismiss. */
export function Banner({ message, onRetry, onDismiss }: Props) {
  return (
    <div className={s.banner} role="alert">
      <div className={s.msg}>
        <Icon name="error" size={18} />
        <span title={message}>{message}</span>
      </div>
      {(onRetry || onDismiss) && (
        <div className={s.actions}>
          {onRetry && (
            <button onClick={onRetry}>
              <Icon name="refresh" />
              Retry
            </button>
          )}
          {onDismiss && (
            <button onClick={onDismiss}>
              <Icon name="close" />
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
