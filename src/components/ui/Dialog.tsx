import { useEffect, useId, useRef, type DialogHTMLAttributes, type FormEvent, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import s from "./Dialog.module.css";

interface Props extends Omit<DialogHTMLAttributes<HTMLDialogElement>, "open" | "title" | "onClose" | "onSubmit"> {
  open: boolean;
  /** Esc, backdrop or `method="dialog"` submit. */
  onClose(): void;
  /** With a title the body is a form: heading row, children, actions. Without one it is a bare modal. */
  title?: ReactNode;
  /** Right side of the heading row. */
  aside?: ReactNode;
  actions?: ReactNode;
  onSubmit?(e: FormEvent<HTMLFormElement>): void;
}

/** Native <dialog>: focus trap, Esc and top layer for free. */
export function Dialog({ open, onClose, title, aside, actions, onSubmit, className, children, ...rest }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      delete d.dataset.closing;
      d.showModal();
    }
    if (!open && d.open && !("closing" in d.dataset)) {
      // Play the exit before leaving the top layer; the timer covers a skipped animationend.
      d.dataset.closing = "";
      const done = () => (clearTimeout(t), d.removeEventListener("animationend", onEnd), d.close());
      // Only the sheet's own exit: children's and the backdrop's animations bubble here too.
      const onEnd = (e: AnimationEvent) => e.target === d && !e.pseudoElement && done();
      const t = setTimeout(done, 400);
      d.addEventListener("animationend", onEnd);
    }
  }, [open]);

  return (
    <dialog ref={ref} className={cx(s.dialog, className)} aria-labelledby={title ? titleId : undefined} onClose={onClose}
      // Esc asks the owner to close, so it gets the same exit animation as Cancel.
      onCancel={(e) => (e.preventDefault(), onClose())} {...rest}>
      {title ? (
        <form method="dialog" className={s.form} onSubmit={(e) => (e.preventDefault(), onSubmit?.(e))}>
          <div className={s.head}>
            <h2 id={titleId}>{title}</h2>
            {aside}
          </div>
          {children}
          {actions && <div className={s.actions}>{actions}</div>}
        </form>
      ) : (
        children
      )}
    </dialog>
  );
}

/** Muted paragraph for dialog copy. */
export function DialogText({ children }: { children: ReactNode }) {
  return <p className={s.text}>{children}</p>;
}
