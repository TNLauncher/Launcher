import { useState } from "react";

/** False until `value` first differs from what it was on mount, then true for the component's lifetime.
 *  Gates entrance animations to real changes: opening a view doesn't replay them, and a later
 *  re-render can't strip the class mid-animation. */
export function useChanged<T>(value: T): boolean {
  const [initial] = useState(value);
  const [changed, setChanged] = useState(false);
  const differs = !Object.is(initial, value);
  if (differs && !changed) setChanged(true);
  return changed || differs;
}
