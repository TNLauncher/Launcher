import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/** Native <dialog>: focus trap, Esc and backdrop for free. */
export function ConfirmDialog({ open, title, children, confirmLabel, danger, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} onClose={onCancel}>
      <form method="dialog" onSubmit={(e) => (e.preventDefault(), onConfirm())}>
        <h2>{title}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {children}
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={`btn primary ${danger ? "destructive" : ""}`} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
