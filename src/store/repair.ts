// Repair and diagnosis per instance. Lives outside components: a full rehash takes minutes and must survive leaving the page.
import { create } from "zustand";
import { launcher } from "@/api/launcher";
import { errorMessage } from "@/lib/format";
import type { Diagnosis, FixAction, Issue, RepairProgress, RepairReport } from "@/types";

export interface FixState {
  status: "busy" | "done" | "error";
  message: string;
}

export interface RepairEntry {
  /** Live progress of a running repair; null when none runs. */
  progress: RepairProgress | null;
  report: RepairReport | null;
  repairError: string;
  diagnosis: Diagnosis | null;
  diagnosing: boolean;
  diagnoseError: string;
  /** By issue key, for issues a fix ran on since the last check. */
  fixes: Record<string, FixState>;
  fixingAll: boolean;
  /** What fixes changed, kept across checks so "Fix all" leaves a record. */
  applied: string[];
}

const EMPTY: RepairEntry = { progress: null, report: null, repairError: "", diagnosis: null, diagnosing: false, diagnoseError: "", fixes: {}, fixingAll: false, applied: [] };

interface RepairStore {
  entries: Record<string, RepairEntry>;
  /** An instance whose page should open on its Repair tab. */
  focus: string | null;
}

export const useRepairStore = create<RepairStore>(() => ({ entries: {}, focus: null }));

const patch = (id: string, p: Partial<RepairEntry> | ((e: RepairEntry) => Partial<RepairEntry>)) =>
  useRepairStore.setState((st) => {
    const cur = st.entries[id] ?? EMPTY;
    return { entries: { ...st.entries, [id]: { ...cur, ...(typeof p === "function" ? p(cur) : p) } } };
  });

const entry = (id: string) => useRepairStore.getState().entries[id] ?? EMPTY;

/** Whether something asked to open this instance on its Repair tab. */
export const useRepairFocus = (id: string) => useRepairStore((st) => st.focus === id);

export const useRepair = (id: string) => useRepairStore((st) => st.entries[id] ?? EMPTY);

/** Fixes that are safe to run without asking each time: everything but deleting a file. */
export const autoFix = (i: Issue) => {
  const f = i.fixes[0];
  return f && f.action.kind !== "deleteMod" ? f : undefined;
};

let frame = 0;

export const repair = {
  /** Opens the instance's page on its Repair tab. */
  focus: (id: string) => useRepairStore.setState({ focus: id }),
  takeFocus: (id: string) => {
    if (useRepairStore.getState().focus !== id) return false;
    useRepairStore.setState({ focus: null });
    return true;
  },

  diagnose: async (id: string) => {
    if (entry(id).diagnosing) return;
    patch(id, { diagnosing: true, diagnoseError: "" });
    try {
      const diagnosis = await launcher.diagnoseInstance(id);
      patch(id, { diagnosis, diagnosing: false, fixes: {} });
    } catch (e) {
      patch(id, { diagnosing: false, diagnoseError: errorMessage(e) });
    }
  },

  /** The last check no longer describes the instance (it ran again, or mods changed). */
  invalidate: (id: string) => patch(id, { diagnosis: null, fixes: {}, applied: [] }),

  run: async (id: string) => {
    if (entry(id).progress) return;
    patch(id, { progress: { step: "game", stage: "resolving", done: 0, total: 0 }, report: null, repairError: "" });
    // Assets report thousands of files: commit at most once per frame.
    let latest: RepairProgress | null = null;
    try {
      const report = await launcher.repairInstance(id, (p) => {
        latest = p;
        frame ||= requestAnimationFrame(() => {
          frame = 0;
          if (latest && entry(id).progress) patch(id, { progress: latest });
        });
      });
      patch(id, { report, progress: null });
    } catch (e) {
      patch(id, { repairError: errorMessage(e), progress: null });
    }
    // Restored files change what the check sees.
    await repair.diagnose(id);
  },

  apply: async (id: string, issue: Issue, action: FixAction, source: string | null) => {
    patch(id, (e) => ({ fixes: { ...e.fixes, [issue.key]: { status: "busy", message: "" } } }));
    try {
      const message = await launcher.applyFix(id, source, action);
      patch(id, (e) => ({ fixes: { ...e.fixes, [issue.key]: { status: "done", message } }, applied: [...e.applied, message] }));
      return true;
    } catch (e) {
      patch(id, (x) => ({ fixes: { ...x.fixes, [issue.key]: { status: "error", message: errorMessage(e) } } }));
      return false;
    }
  },

  /** Runs each open issue's recommended fix in order, then checks again: one fix often uncovers the next problem. */
  fixAll: async (id: string, source: string | null) => {
    const e = entry(id);
    if (!e.diagnosis || e.fixingAll) return;
    patch(id, { fixingAll: true });
    for (const issue of e.diagnosis.issues) {
      const f = autoFix(issue);
      if (f && entry(id).fixes[issue.key]?.status !== "done") await repair.apply(id, issue, f.action, source);
    }
    patch(id, { fixingAll: false });
    await repair.diagnose(id);
  },
};
