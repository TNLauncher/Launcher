import { useRef, useState } from "react";
import { Button, Dialog, Icon } from "@/components/ui";
import { cx } from "@/lib/cx";
import { plural } from "@/lib/format";
import type { ContentKind } from "@/types";
import { candidateKey, type UpdateCandidate } from "./useContent";
import s from "./UpdateDialog.module.css";

const GROUPS: Record<ContentKind, { label: string; icon: string }> = {
  mod: { label: "Mods", icon: "extension" },
  resourcepack: { label: "Resource packs", icon: "texture" },
  shader: { label: "Shaders", icon: "wb_twilight" },
};

/** Prism-style review before updating: every outdated file with its version jump, all picked by default. */
export function UpdateDialog({ candidates, onClose, onConfirm }: { candidates: UpdateCandidate[] | null; onClose(): void; onConfirm(picked: UpdateCandidate[]): void }) {
  // The list stays put while the dialog plays its exit.
  const last = useRef<UpdateCandidate[]>([]);
  if (candidates) last.current = candidates;
  const list = last.current;

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [shownFor, setShownFor] = useState<UpdateCandidate[] | null>(null);
  if (candidates && candidates !== shownFor) {
    setShownFor(candidates);
    setPicked(new Set(candidates.map(candidateKey)));
  }

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const all = picked.size === list.length;
  const kinds = [...new Set(list.map((c) => c.kind))];

  return (
    <Dialog
      open={!!candidates}
      onClose={onClose}
      onSubmit={() => onConfirm(list.filter((c) => picked.has(candidateKey(c))))}
      className={s.dialog}
      title={`${plural(list.length, "update")} available`}
      aside={
        <label className={s.all}>
          <input
            type="checkbox"
            className={s.box}
            checked={all}
            ref={(el) => void (el && (el.indeterminate = picked.size > 0 && !all))}
            onChange={() => setPicked(all ? new Set() : new Set(list.map(candidateKey)))}
          />
          Select all
        </label>
      }
      actions={
        <>
          <span className={s.summary}>
            {picked.size} of {list.length} selected
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" icon="upgrade" disabled={!picked.size} autoFocus>
            {picked.size ? `Update ${picked.size}` : "Update"}
          </Button>
        </>
      }
    >
      <div className={s.list}>
        {kinds.map((kind) => {
          const group = list.filter((c) => c.kind === kind);
          return (
            <section key={kind} className={s.group} aria-label={GROUPS[kind].label}>
              {kinds.length > 1 && (
                <h3 className={s.groupHead}>
                  <Icon name={GROUPS[kind].icon} />
                  {GROUPS[kind].label}
                  <span className={s.groupCount}>{group.length}</span>
                </h3>
              )}
              {group.map((c) => {
                const key = candidateKey(c);
                const on = picked.has(key);
                return (
                  <label key={key} className={cx(s.row, !on && s.off)}>
                    <input type="checkbox" className={s.box} checked={on} onChange={() => toggle(key)} />
                    <span className={s.icon}>{c.project.iconUrl ? <img src={c.project.iconUrl} alt="" loading="lazy" /> : <Icon name={GROUPS[kind].icon} />}</span>
                    <span className={s.text}>
                      <span className={s.title}>{c.project.title}</span>
                      <span className={s.file} title={c.file}>{c.file}</span>
                    </span>
                    <span className={s.jump}>
                      {c.from && (
                        <>
                          <span className={s.from} title={c.from}>{c.from}</span>
                          <Icon name="arrow_forward" className={s.arrow} />
                        </>
                      )}
                      <span className={s.to} title={c.to.number}>{c.to.number}</span>
                      {c.to.channel !== "release" && <span className={s.channel}>{c.to.channel}</span>}
                    </span>
                  </label>
                );
              })}
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}
