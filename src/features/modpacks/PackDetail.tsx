import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";
import { primaryFile, sources, type Hit, type SourceInfo, type Version } from "@/api/sources";
import { Banner, Button, Field, Icon, IconButton, Select, Skeleton, Tab, Tabs } from "@/components/ui";
import { Markdown } from "@/components/ui/Markdown";
import { cx } from "@/lib/cx";
import { useFavorites } from "@/hooks/useSource";
import { ago, compact, dateLabel, errorMessage, loaderList, megabytes } from "@/lib/format";
import { useInstalling } from "@/store/imports";
import { useLauncher } from "@/store/LauncherContext";
import { useBackLabel } from "@/components/layout/Sidebar";
import { useRouteState, useUi } from "@/store/UiContext";
import { About, Gallery, TextSkeleton, VersionList } from "./detail";
import { packColor } from "./ModpacksView";
import s from "./modpacks.module.css";

type Section = "description" | "gallery" | "mods" | "versions";

/** One modpack: what it is, what is inside, and which version to install. */
export function PackDetail({ source, hit, preferredVersion, onBack }: { source: SourceInfo; hit: Hit; preferredVersion: string; onBack(): void }) {
  const id = hit.id;
  const project = useQuery({ queryKey: ["project", source.id, id], queryFn: () => sources.project(source.id, id) });
  const versions = useQuery({ queryKey: ["pack-versions", source.id, id], queryFn: () => sources.versions(source.id, id, { kind: "modpack" }) });
  const [tab, setTab] = useRouteState<Section>("pack.tab", "description");
  const backLabel = useBackLabel();
  const [mc, setMc] = useState("");
  const [versionId, setVersionId] = useState("");
  const top = useRef<HTMLDivElement>(null);
  const favorites = useFavorites(source.id, "modpack");
  const favorite = favorites.ids.has(id);

  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" });
  }, [id]);

  // Minecraft versions in the order the pack shipped them, newest first.
  const all = versions.data ?? [];
  const mcOptions = useMemo(() => [...new Set(all.flatMap((v) => [...v.gameVersions].reverse()))], [all]);
  const chosenMc = mcOptions.includes(mc) ? mc : mcOptions.includes(preferredVersion) ? preferredVersion : (mcOptions[0] ?? "");
  const forMc = all.filter((v) => v.gameVersions.includes(chosenMc));
  const version = forMc.find((v) => v.id === versionId) ?? forMc.find((v) => v.channel === "release") ?? forMc[0];

  const gallery = useMemo(
    () => [...(project.data?.gallery ?? [])].sort((a, b) => Number(b.featured) - Number(a.featured)),
    [project.data]
  );
  const banner = hit.bannerUrl ?? gallery[0]?.url;
  const modCount = version?.dependencies.length ?? 0;

  return (
    <div className={s.packPage} style={{ "--pack": packColor(hit.color) } as React.CSSProperties}>
      <div ref={top} />
      <div className={s.packHero}>
        {banner && <img className={s.packHeroBg} src={banner} alt="" />}
        <div className={s.packHeroInner}>
          <div className={s.packBar}>
            <Button variant="overlay" size="sm" icon="arrow_back" onClick={onBack}>
              {backLabel}
            </Button>
            <IconButton
              icon="star"
              variant="overlay"
              fill={favorite}
              aria-pressed={favorite}
              label={favorite ? "Remove from favorites" : "Add to favorites"}
              onClick={() => favorites.toggle(hit)}
            />
          </div>
          <div className={s.packHeroMain}>
            <span className={cx(s.packIcon, s.big)}>{hit.iconUrl ? <img src={hit.iconUrl} alt="" /> : <Icon name="inventory_2" />}</span>
            <div className={s.packHeroText}>
              <h1>{hit.title}</h1>
              <p>{hit.description}</p>
              <div className={s.packMeta}>
                <span className={s.stat}>by <b>{hit.author}</b></span>
                <span className={cx(s.stat, "mono")}><Icon name="download" />{compact(hit.downloads)}</span>
                <span className={cx(s.stat, "mono")}><Icon name="favorite" />{compact(hit.follows)}</span>
                <span className={s.stat}><Icon name="update" />Updated {ago(hit.updated)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={s.packColumns}>
        <div className={s.packContent}>
          <Tabs label="Modpack sections">
            <Tab selected={tab === "description"} onSelect={() => setTab("description")}>Description</Tab>
            {gallery.length > 0 && <Tab selected={tab === "gallery"} onSelect={() => setTab("gallery")} count={gallery.length}>Gallery</Tab>}
            {modCount > 0 && <Tab selected={tab === "mods"} onSelect={() => setTab("mods")} count={modCount}>Mods</Tab>}
            <Tab selected={tab === "versions"} onSelect={() => setTab("versions")} count={all.length || undefined}>Versions</Tab>
          </Tabs>
          <div role="tabpanel">
            {project.isError ? (
              <Banner message={`Could not load this modpack: ${errorMessage(project.error)}`} onRetry={() => project.refetch()} />
            ) : tab === "description" ? (
              project.data ? <Markdown source={project.data.body} /> : <TextSkeleton />
            ) : tab === "gallery" ? (
              <Gallery images={gallery} />
            ) : tab === "mods" && version ? (
              <ModList source={source} version={version} />
            ) : (
              <VersionList versions={all} loading={versions.isPending} empty="No versions the launcher can run." selected={version} onSelect={(v) => { setMc(v.gameVersions.at(-1) ?? ""); setVersionId(v.id); }} />
            )}
          </div>
        </div>

        <aside className={s.packSide}>
          <InstallCard
            source={source}
            hit={hit}
            loading={versions.isPending}
            error={versions.isError ? errorMessage(versions.error) : ""}
            onRetry={() => versions.refetch()}
            mcOptions={mcOptions}
            mc={chosenMc}
            onMc={(v) => { setMc(v); setVersionId(""); }}
            forMc={forMc}
            version={version}
            onVersion={setVersionId}
          />
          {project.data && <About project={project.data} />}
        </aside>
      </div>
    </div>
  );
}

function InstallCard(p: {
  source: SourceInfo;
  hit: Hit;
  loading: boolean;
  error: string;
  onRetry(): void;
  mcOptions: string[];
  mc: string;
  onMc(v: string): void;
  forMc: Version[];
  version: Version | undefined;
  onVersion(id: string): void;
}) {
  const startImport = useLauncher((st) => st.startImport);
  const navigate = useUi((st) => st.navigate);
  const installing = useInstalling(p.hit.id);
  const file = p.version && primaryFile(p.version);

  return (
    <div className={s.sideCard}>
      <h2>Create instance</h2>
      {p.error ? (
        <Banner message={`Could not load versions: ${p.error}`} onRetry={p.onRetry} />
      ) : !p.loading && !p.mcOptions.length ? (
        <p className={s.note}>This modpack has no version the launcher can run.</p>
      ) : (
        <>
          <Field label="Minecraft version" asLabel={false}>
            <Select label="Minecraft version" className={s.sideCardSelect} value={p.mc} onChange={p.onMc} placeholder="Loading…" options={p.mcOptions.map((v) => ({ value: v, label: v }))} />
          </Field>
          <Field label="Modpack version" asLabel={false}>
            <Select
              label="Modpack version"
              className={s.sideCardSelect}
              value={p.version?.id ?? ""}
              onChange={p.onVersion}
              placeholder="Loading…"
              options={p.forMc.map((v) => ({ value: v.id, label: v.number, hint: v.channel === "release" ? undefined : v.channel }))}
            />
          </Field>
          {p.version && (
            <dl className={s.installFacts}>
              <dt>Loader</dt>
              <dd>{loaderList(p.version.loaders)}</dd>
              <dt>Released</dt>
              <dd>{dateLabel(p.version.published)}</dd>
              <dt>Mods</dt>
              <dd className="mono">{p.version.dependencies.length || "—"}</dd>
              {file && (
                <>
                  <dt>Pack file</dt>
                  <dd className="mono">{megabytes(file.size)}</dd>
                </>
              )}
            </dl>
          )}
          {p.version && p.version.channel !== "release" && (
            <p className={s.installNote}>
              <Icon name="science" />
              This is a {p.version.channel} build and may be unstable.
            </p>
          )}
          <Button
            variant="primary"
            size="lg"
            icon="download"
            className={s.installBtn}
            disabled={!p.version}
            loading={installing}
            onClick={() => {
              startImport(p.source.id, p.hit, p.version);
              navigate("instances");
            }}
          >
            {installing ? "Installing…" : "Install"}
          </Button>
          <p className={s.note}>Mods download now; Minecraft itself downloads on first launch.</p>
        </>
      )}
    </div>
  );
}

function ModList({ source, version }: { source: SourceInfo; version: Version }) {
  const ids = useMemo(() => [...new Set(version.dependencies.flatMap((d) => (d.projectId ? [d.projectId] : [])))], [version]);
  const external = version.dependencies.filter((d) => !d.projectId && d.fileName).map((d) => d.fileName!);
  const mods = useQuery({
    queryKey: ["projects", source.id, ids],
    queryFn: () => sources.projects(source.id, ids).then((list) => list.sort((a, b) => a.title.localeCompare(b.title))),
    enabled: ids.length > 0,
  });

  if (mods.isError) return <Banner message={`Could not load the mod list: ${errorMessage(mods.error)}`} onRetry={() => mods.refetch()} />;
  if (ids.length && !mods.data) return <div className={s.modGrid}>{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} height={56} />)}</div>;
  return (
    <>
      <p className={s.note}>
        Contents of version <span className="mono">{version.number}</span>.
      </p>
      <div className={s.modGrid}>
        {mods.data?.map((m) => (
          <button key={m.id} className={s.modCell} title={m.description} onClick={() => openUrl(m.url)}>
            <span className={s.packIcon}>{m.iconUrl ? <img src={m.iconUrl} alt="" loading="lazy" /> : <Icon name="extension" />}</span>
            <span className={s.modCellText}>
              <b>{m.title}</b>
              <span>{m.kind === "mod" ? m.description : m.kind.replace("resourcepack", "resource pack")}</span>
            </span>
          </button>
        ))}
        {external.map((f) => (
          <div key={f} className={s.modCell}>
            <span className={s.packIcon}><Icon name="draft" /></span>
            <span className={s.modCellText}><b>{f}</b><span>Not hosted on {source.name}</span></span>
          </div>
        ))}
      </div>
    </>
  );
}
