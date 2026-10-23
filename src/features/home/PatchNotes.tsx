import { useEffect, useState } from "react";
import { getPatchNotes, type PatchNote } from "@/api/mojang";
import { Dot, SectionHead, Skeleton } from "@/components/ui";
import s from "./home.module.css";

export function PatchNotes() {
  const [notes, setNotes] = useState<PatchNote[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getPatchNotes().then(setNotes, () => setFailed(true));
  }, []);

  return (
    <div className={s.section}>
      <SectionHead title="Minecraft patch notes" />
      <div className={s.news}>
        {failed ? (
          <div className={s.newsRow}><div className={s.newsTitle}><Dot className={s.newsDot} /><span>Patch notes are unavailable offline.</span></div></div>
        ) : !notes ? (
          <Skeleton height={120} />
        ) : (
          notes.map((n) => (
            <div className={s.newsRow} key={n.version}>
              <div className={s.newsTitle}><Dot className={s.newsDot} /><span>{n.title}</span></div>
              <span className="mono subtle">
                {new Date(n.date).toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" })}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
