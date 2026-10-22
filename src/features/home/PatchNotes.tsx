import { useEffect, useState } from "react";
import { getPatchNotes, type PatchNote } from "@/api/mojang";

export function PatchNotes() {
  const [notes, setNotes] = useState<PatchNote[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getPatchNotes().then(setNotes, () => setFailed(true));
  }, []);

  return (
    <div className="home-section">
      <div className="section-head">
        <h2>Minecraft patch notes</h2>
      </div>
      <div className="news">
        {failed ? (
          <div className="news-row"><div className="t"><span className="dot" /><span>Patch notes are unavailable offline.</span></div></div>
        ) : !notes ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : (
          notes.map((n) => (
            <div className="news-row" key={n.version}>
              <div className="t"><span className="dot" /><span>{n.title}</span></div>
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
