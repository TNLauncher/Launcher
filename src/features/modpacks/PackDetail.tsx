import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";
import { getPackVersions, getProject, getProjectsChunked, primaryFile, type GalleryImage, type PackHit, type PackVersion, type Project } from "@/api/modrinth";
import { Banner, Button, Chip, Dialog, EmptyState, Field, Icon, IconButton, Select, Skeleton, Tab, Tabs } from "@/components/ui";
import { Markdown } from "@/components/ui/Markdown";
import { cx } from "@/lib/cx";
import { ago, compact, errorMessage, megabytes } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import { packColor } from "./ModpacksView";
import s from "./modpacks.module.css";

type Section = "description" | "gallery" | "mods" | "versions";
const LOADER_NAME: Record<string, string> = { fabric: "Fabric", quilt: "Quilt" };

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });

/** One modpack: what it is, what is inside, and which version to install. */
export function PackDetail({ hit, preferredVersion, onBack }: { hit: PackHit; preferredVersion: string; onBack(): void }) {
  const id = hit.project_id;
  const project = useQuery({ queryKey: ["project", id], queryFn: () => getProject(id) });
  const versions = useQuery({ queryKey: ["pack-versions", id], queryFn: () => getPackVersions(id) });
  const [tab, setTab] = useState<Section>("description");
  const [mc, setMc] = useState("");
  const [versionId, setVersionId] = useState("");
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" });
  }, [id]);

  // Minecraft versions in the order the pack shipped them, newest first.
  const all = versions.data ?? [];
  const mcOptions = useMemo(() => [...new Set(all.flatMap((v) => [...v.game_versions].reverse()))], [all]);
  const chosenMc = mcOptions.includes(mc) ? mc : mcOptions.includes(preferredVersion) ? preferredVersion : (mcOptions[0] ?? "");
  const forMc = all.filter((v) => v.game_versions.includes(chosenMc));
  const version = forMc.find((v) => v.id === versionId) ?? forMc.find((v) => v.version_type === "release") ?? forMc[0];

  const gallery = useMemo(
    () => [...(project.data?.gallery ?? [])].sort((a, b) => Number(b.featured) - Number(a.featured)),
    [project.data]
  );
  const banner = hit.featured_gallery ?? gallery[0]?.url;
  const modCount = version?.dependencies.length ?? 0;

  return (
    <div className={s.packPage} style={{ "--pack": packColor(hit.color) } as React.CSSProperties}>
      <div ref={top} />
      <div className={s.packHero}>
        {banner && <img className={s.packHeroBg} src={banner} alt="" />}
        <div className={s.packHeroInner}>
          <Button variant="overlay" size="sm" icon="arrow_back" className={s.packBack} onClick={onBack}>
            Modpacks
          </Button>
          <div className={s.packHeroMain}>
            <span className={cx(s.packIcon, s.big)}>{hit.icon_url ? <img src={hit.icon_url} alt="" /> : <Icon name="inventory_2" />}</span>
            <div className={s.packHeroText}>
              <h1>{hit.title}</h1>
              <p>{hit.description}</p>
              <div className={s.packMeta}>
                <span className={s.stat}>by <b>{hit.author}</b></span>
                <span className={cx(s.stat, "mono")}><Icon name="download" />{compact(hit.downloads)}</span>
                <span className={cx(s.stat, "mono")}><Icon name="favorite" />{compact(hit.follows)}</span>
                <span className={s.stat}><Icon name="update" />Updated {ago(hit.date_modified)}</span>
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
              <ModList version={version} />
            ) : (
              <VersionList versions={all} loading={versions.isPending} selected={version} onSelect={(v) => { setMc(v.game_versions.at(-1) ?? ""); setVersionId(v.id); }} />
            )}
          </div>
        </div>

        <aside className={s.packSide}>
          <InstallCard
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
  hit: PackHit;
  loading: boolean;
  error: string;
  onRetry(): void;
  mcOptions: string[];
  mc: string;
  onMc(v: string): void;
  forMc: PackVersion[];
  version: PackVersion | undefined;
  onVersion(id: string): void;
}) {
  const { imports, startImport } = useLauncher();
  const { navigate } = useUi();
  const installing = imports.some((i) => i.projectId === p.hit.project_id && !i.error);
  const file = p.version && primaryFile(p.version);

  return (
    <div className={s.sideCard}>
      <h2>Create instance</h2>
      {p.error ? (
        <Banner message={`Could not load versions: ${p.error}`} onRetry={p.onRetry} />
      ) : !p.loading && !p.mcOptions.length ? (
        <p className={s.note}>This modpack has no Fabric or Quilt version the launcher can run.</p>
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
              options={p.forMc.map((v) => ({ value: v.id, label: v.version_number, hint: v.version_type === "release" ? undefined : v.version_type }))}
            />
          </Field>
          {p.version && (
            <dl className={s.installFacts}>
              <dt>Loader</dt>
              <dd>{p.version.loaders.map((l) => LOADER_NAME[l] ?? l).join(", ")}</dd>
              <dt>Released</dt>
              <dd>{dateLabel(p.version.date_published)}</dd>
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
          {p.version && p.version.version_type !== "release" && (
            <p className={s.installNote}>
              <Icon name="science" />
              This is a {p.version.version_type} build and may be unstable.
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
              startImport(p.hit, p.version);
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

function About({ project: p }: { project: Project }) {
  const links: [string, string, string | null][] = [
    ["Modrinth page", "open_in_new", `https://modrinth.com/modpack/${p.slug}`],
    ["Source code", "code", p.source_url],
    ["Issues", "bug_report", p.issues_url],
    ["Wiki", "menu_book", p.wiki_url],
    ["Discord", "forum", p.discord_url],
  ];
  return (
    <div className={s.sideCard}>
      <h2>About</h2>
      <dl className={s.installFacts}>
        <dt>Published</dt>
        <dd>{dateLabel(p.published)}</dd>
        {p.license && (
          <>
            <dt>License</dt>
            <dd>{p.license.id.replace(/^LicenseRef-/, "")}</dd>
          </>
        )}
      </dl>
      <div className={s.sideLinks}>
        {links.map(([label, icon, url]) =>
          url ? (
            <button key={label} className={s.sideLink} onClick={() => openUrl(url)}>
              <Icon name={icon} />
              {label}
            </button>
          ) : null
        )}
      </div>
    </div>
  );
}

function Gallery({ images }: { images: GalleryImage[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const close = () => setIndex(null);
  const shown = index == null ? null : images[index];
  const step = (d: number) => setIndex((i) => (i == null ? i : (i + d + images.length) % images.length));

  return (
    <>
      <div className={s.gallery}>
        {images.map((img, i) => (
          <button key={img.url} className={s.galleryItem} onClick={() => setIndex(i)}>
            <img src={img.url} alt={img.title ?? ""} loading="lazy" />
            {img.title && <span>{img.title}</span>}
          </button>
        ))}
      </div>
      <Dialog
        open={index != null}
        className={s.lightbox}
        aria-label="Screenshot"
        onClose={close}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") step(1);
          if (e.key === "ArrowLeft") step(-1);
        }}
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        {shown && (
          <figure>
            <img src={shown.raw_url} alt={shown.title ?? ""} />
            <figcaption>
              <div>
                {shown.title && <b>{shown.title}</b>}
                {shown.description && <span>{shown.description}</span>}
              </div>
              <div className={s.lightboxNav}>
                <span className={cx(s.lightboxCount, "mono")}>{(index ?? 0) + 1} / {images.length}</span>
                <IconButton icon="chevron_left" label="Previous" onClick={() => step(-1)} />
                <IconButton icon="chevron_right" label="Next" onClick={() => step(1)} />
                <IconButton icon="close" label="Close" onClick={close} />
              </div>
            </figcaption>
          </figure>
        )}
      </Dialog>
    </>
  );
}

function ModList({ version }: { version: PackVersion }) {
  const ids = useMemo(() => [...new Set(version.dependencies.flatMap((d) => (d.project_id ? [d.project_id] : [])))], [version]);
  const external = version.dependencies.filter((d) => !d.project_id && d.file_name).map((d) => d.file_name!);
  const mods = useQuery({ queryKey: ["projects", ids], queryFn: () => getProjectsChunked(ids), enabled: ids.length > 0 });

  if (mods.isError) return <Banner message={`Could not load the mod list: ${errorMessage(mods.error)}`} onRetry={() => mods.refetch()} />;
  if (ids.length && !mods.data) return <div className={s.modGrid}>{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} height={56} />)}</div>;
  return (
    <>
      <p className={s.note}>
        Contents of version <span className="mono">{version.version_number}</span>.
      </p>
      <div className={s.modGrid}>
        {mods.data?.map((m) => (
          <button key={m.id} className={s.modCell} title={m.description} onClick={() => openUrl(`https://modrinth.com/${m.project_type}/${m.slug}`)}>
            <span className={s.packIcon}>{m.icon_url ? <img src={m.icon_url} alt="" loading="lazy" /> : <Icon name="extension" />}</span>
            <span className={s.modCellText}>
              <b>{m.title}</b>
              <span>{m.project_type === "mod" ? m.description : m.project_type.replace("resourcepack", "resource pack")}</span>
            </span>
          </button>
        ))}
        {external.map((f) => (
          <div key={f} className={s.modCell}>
            <span className={s.packIcon}><Icon name="draft" /></span>
            <span className={s.modCellText}><b>{f}</b><span>Not hosted on Modrinth</span></span>
          </div>
        ))}
      </div>
    </>
  );
}

function VersionList({ versions, loading, selected, onSelect }: { versions: PackVersion[]; loading: boolean; selected?: PackVersion; onSelect(v: PackVersion): void }) {
  if (loading) return <TextSkeleton />;
  if (!versions.length) return <EmptyState icon="history">No Fabric or Quilt versions.</EmptyState>;
  return (
    <div className={s.versions}>
      {versions.map((v) => {
        const on = v.id === selected?.id;
        return (
          <div key={v.id} className={cx(s.version, on && s.on)}>
            <button className={s.versionHead} aria-expanded={on} onClick={() => onSelect(v)}>
              <span className={cx(s.vtype, s[v.version_type])} title={v.version_type}>{v.version_type[0].toUpperCase()}</span>
              <span className={s.versionName}>
                <b>{v.version_number}</b>
                <span>{v.name}</span>
              </span>
              <Chip variant="tag" className={s.versionTag}>{v.game_versions.join(", ")}</Chip>
              <Chip>{v.loaders.map((l) => LOADER_NAME[l] ?? l).join(", ")}</Chip>
              <span className={s.versionDate}>{dateLabel(v.date_published)}</span>
              {on && <Icon name="check_circle" fill className={s.versionCheck} />}
            </button>
            {on && (
              <div className={s.versionBody}>
                {v.changelog?.trim() ? <Markdown source={v.changelog} /> : <p className={s.note}>No changelog for this version.</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TextSkeleton() {
  return (
    <div className={s.textSkeleton}>
      {[92, 100, 76, 0, 100, 88, 64].map((w, i) => (w ? <Skeleton key={i} className={s.line} height={12} width={`${w}%`} /> : <span key={i} />))}
    </div>
  );
}
