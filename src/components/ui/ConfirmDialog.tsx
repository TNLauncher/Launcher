import type { ReactNode } from "react";
import { Button } from "./Button";
import { Dialog, DialogText } from "./Dialog";

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({ open, title, children, confirmLabel, danger, onConfirm, onCancel }: Props) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      onSubmit={onConfirm}
      actions={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant={danger ? "destructive" : "primary"} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <DialogText>{children}</DialogText>
    </Dialog>
  );
}
