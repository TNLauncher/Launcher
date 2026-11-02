import { useQuery } from "@tanstack/react-query";
import { getPatchNotes } from "@/api/mojang";
import { SectionHead, Skeleton } from "@/components/ui";
import s from "./home.module.css";

export function PatchNotes() {
  // Once per session: Home remounts on every visit.
  const q = useQuery({ queryKey: ["patch-notes"], queryFn: () => getPatchNotes(6), staleTime: Infinity });
  const notes = q.data;
  const failed = q.isError;

  return (
    <div className={`${s.cell} ${s.pane} ${s.newsPane}`}>
      <SectionHead title="Patch notes" />
      {failed ? (
        <p className={s.newsEmpty}>Patch notes are unavailable offline.</p>
      ) : !notes ? (
        <div className={s.news}>{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} height={36} />)}</div>
      ) : (
        <ol className={s.news}>
          {notes.map((n) => (
            <li key={n.version}>
              <span>{n.title.replace(/^Minecraft:? Java Edition /i, "")}</span>
              <time className={s.newsDate} dateTime={n.date}>
                {new Date(n.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
