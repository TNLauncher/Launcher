import { invoke, type InvokeArgs } from "@tauri-apps/api/core";

/** Error shape produced by `AppError`'s Serialize impl in src-tauri/src/error.rs. */
export class BackendError extends Error {
  readonly kind: string;
  constructor(kind: string, message: string) {
    super(message);
    this.kind = kind;
  }
}

function toError(e: unknown): Error {
  if (e && typeof e === "object" && "kind" in e && "message" in e) {
    return new BackendError(String(e.kind), String(e.message));
  }
  return e instanceof Error ? e : new Error(String(e));
}

/** `invoke` that always rejects with an `Error`. */
export async function call<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toError(e);
  }
}
