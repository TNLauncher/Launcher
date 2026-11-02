import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { launcher } from "@/api/launcher";
import { SectionHead } from "@/components/ui";
import { loaderLabel } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import type { ContentKind, Instance } from "@/types";
import s from "./home.module.css";

const hours = (sec: number) => (sec < 3600 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)} h`);
const day = (ts: number) => new Date(ts * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** What's inside the armed instance and how it runs, as a spec sheet. */
export function InstanceSpec({ inst }: { inst: Instance }) {
  const settings = useLauncher((st) => st.snapshot?.settings);
  const ramMb = inst.settings.ramMb ?? settings?.ramMb ?? 0;
  const java = inst.settings.javaPath ?? settings?.javaPath ?? "";
  const modded = inst.loader !== "vanilla";

  const rows: (false | [string, ReactNode])[] = [
    [inst.runtime ? "Game" : "Loader", loaderLabel(inst)],
    modded && ["Mods", <Count id={inst.id} kind="mod" />],
    ["Resource packs", <Count id={inst.id} kind="resourcepack" />],
    ["Shaders", <Count id={inst.id} kind="shader" />],
    // A runtime's game is not a JVM: the memory setting does not reach it.
    !inst.runtime && ["Memory", ramMb ? `${+(ramMb / 1024).toFixed(1)} GB` : "Default"],
    ["Java", java ? <span title={java}>{java.split(/[\\/]/).slice(-3).join("/")}</span> : "Bundled runtime"],
    ["Play time", inst.playSeconds ? hours(inst.playSeconds) : "None yet"],
    ["Source", inst.pack ? `Modpack ${inst.pack.version}` : "Made by hand"],
    !!inst.created && ["Created", day(inst.created)],
  ];

  return (
    <div className={`${s.cell} ${s.pane} ${s.specPane}`}>
      <SectionHead title="Details" />
      <dl className={s.spec}>
        {rows.filter((r) => r !== false).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Enabled count, with the disabled ones noted; shares its cache with the instance's content tabs. */
function Count({ id, kind }: { id: string; kind: ContentKind }) {
  const q = useQuery({ queryKey: ["content", id, kind], queryFn: () => launcher.listContent(id, kind) });
  if (!q.data) return <span className="subtle">{q.isError ? "Unavailable" : "…"}</span>;
  const on = q.data.filter((f) => f.enabled).length;
  const off = q.data.length - on;
  return (
    <>
      {on}
      {off > 0 && <span className="subtle"> · {off} off</span>}
    </>
  );
}
