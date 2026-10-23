import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";
import { getPackVersions, getProject, getProjectsChunked, primaryFile, type GalleryImage, type PackHit, type PackVersion, type Project } from "@/api/modrinth";
import { Banner } from "@/components/ui/Banner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import { Select } from "@/components/ui/Select";
import { ago, compact, errorMessage, megabytes } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import { packColor } from "./ModpacksView";

type Tab = "description" | "gallery" | "mods" | "versions";
const LOADER_NAME: Record<string, string> = { fabric: "Fabric", quilt: "Quilt" };

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });

/** One modpack: what it is, what is inside, and which version to install. */
export function PackDetail({ hit, preferredVersion, onBack }: { hit: PackHit; preferredVersion: string; onBack(): void }) {
  const id = hit.project_id;
  const project = useQuery({ queryKey: ["project", id], queryFn: () => getProject(id) });
  const versions = useQuery({ queryKey: ["pack-versions", id], queryFn: () => getPackVersions(id) });
  const [tab, setTab] = useState<Tab>("description");
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
    <div className="pack-page" style={{ "--pack": packColor(hit.color) } as React.CSSProperties}>
      <div ref={top} />
      <div className="pack-hero">
        {banner && <img className="pack-hero-bg" src={banner} alt="" />}
        <div className="pack-hero-inner">
          <button className="btn small pack-back" onClick={onBack}>
            <Icon name="arrow_back" />
            Modpacks
          </button>
          <div className="pack-hero-main">
            <span className="pack-icon big">{hit.icon_url ? <img src={hit.icon_url} alt="" /> : <Icon name="inventory_2" />}</span>
            <div className="pack-hero-text">
              <h1>{hit.title}</h1>
              <p>{hit.description}</p>
              <div className="pack-meta">
                <span>by <b>{hit.author}</b></span>
                <span className="mono"><Icon name="download" />{compact(hit.downloads)}</span>
                <span className="mono"><Icon name="favorite" />{compact(hit.follows)}</span>
                <span><Icon name="update" />Updated {ago(hit.date_modified)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="pack-columns">
        <div className="pack-content">
          <div className="tabs" role="tablist" aria-label="Modpack sections">
            <TabButton tab="description" current={tab} onSelect={setTab}>Description</TabButton>
            {gallery.length > 0 && <TabButton tab="gallery" current={tab} onSelect={setTab}>Gallery <span className="mono">{gallery.length}</span></TabButton>}
            {modCount > 0 && <TabButton tab="mods" current={tab} onSelect={setTab}>Mods <span className="mono">{modCount}</span></TabButton>}
            <TabButton tab="versions" current={tab} onSelect={setTab}>Versions <span className="mono">{all.length || ""}</span></TabButton>
          </div>
          <div role="tabpanel" className="pack-panel">
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

        <aside className="pack-side">
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

function TabButton({ tab, current, onSelect, children }: { tab: Tab; current: Tab; onSelect(t: Tab): void; children: React.ReactNode }) {
  return (
    <button role="tab" className="tab" aria-selected={tab === current} onClick={() => onSelect(tab)}>
      {children}
    </button>
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
    <div className="side-card install-card">
      <h2>Create instance</h2>
      {p.error ? (
        <Banner message={`Could not load versions: ${p.error}`} onRetry={p.onRetry} />
      ) : !p.loading && !p.mcOptions.length ? (
        <p className="muted small">This modpack has no Fabric or Quilt version the launcher can run.</p>
      ) : (
        <>
          <div className="field">
            <span>Minecraft version</span>
            <Select label="Minecraft version" value={p.mc} onChange={p.onMc} placeholder="Loading…" options={p.mcOptions.map((v) => ({ value: v, label: v }))} />
          </div>
          <div className="field">
            <span>Modpack version</span>
            <Select
              label="Modpack version"
              value={p.version?.id ?? ""}
              onChange={p.onVersion}
              placeholder="Loading…"
              options={p.forMc.map((v) => ({ value: v.id, label: v.version_number, hint: v.version_type === "release" ? undefined : v.version_type }))}
            />
          </div>
          {p.version && (
            <dl className="install-facts">
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
            <p className="install-note">
              <Icon name="science" />
              This is a {p.version.version_type} build and may be unstable.
            </p>
          )}
          <button
            className="btn primary install-btn"
            disabled={!p.version || installing}
            onClick={() => {
              startImport(p.hit, p.version);
              navigate("instances");
            }}
          >
            <Icon name={installing ? "progress_activity" : "download"} spin={installing} />
            {installing ? "Installing…" : "Install"}
          </button>
          <p className="muted small">Mods download now; Minecraft itself downloads on first launch.</p>
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
    <div className="side-card">
      <h2>About</h2>
      <dl className="install-facts">
        <dt>Published</dt>
        <dd>{dateLabel(p.published)}</dd>
        {p.license && (
          <>
            <dt>License</dt>
            <dd>{p.license.id.replace(/^LicenseRef-/, "")}</dd>
          </>
        )}
      </dl>
      <div className="side-links">
        {links.map(([label, icon, url]) =>
          url ? (
            <button key={label} className="side-link" onClick={() => openUrl(url)}>
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
  const dialog = useRef<HTMLDialogElement>(null);
  const shown = index == null ? null : images[index];
  const step = (d: number) => setIndex((i) => (i == null ? i : (i + d + images.length) % images.length));

  useEffect(() => {
    if (index != null && !dialog.current?.open) dialog.current?.showModal();
  }, [index]);

  return (
    <>
      <div className="gallery">
        {images.map((img, i) => (
          <button key={img.url} className="gallery-item" onClick={() => setIndex(i)}>
            <img src={img.url} alt={img.title ?? ""} loading="lazy" />
            {img.title && <span>{img.title}</span>}
          </button>
        ))}
      </div>
      <dialog
        ref={dialog}
        className="lightbox"
        aria-label="Screenshot"
        onClose={() => setIndex(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") step(1);
          if (e.key === "ArrowLeft") step(-1);
        }}
        onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
      >
        {shown && (
          <figure>
            <img src={shown.raw_url} alt={shown.title ?? ""} />
            <figcaption>
              <div>
                {shown.title && <b>{shown.title}</b>}
                {shown.description && <span>{shown.description}</span>}
              </div>
              <div className="lightbox-nav">
                <span className="mono">{(index ?? 0) + 1} / {images.length}</span>
                <button className="icon-btn" aria-label="Previous" onClick={() => step(-1)}><Icon name="chevron_left" /></button>
                <button className="icon-btn" aria-label="Next" onClick={() => step(1)}><Icon name="chevron_right" /></button>
                <button className="icon-btn" aria-label="Close" onClick={() => dialog.current?.close()}><Icon name="close" /></button>
              </div>
            </figcaption>
          </figure>
        )}
      </dialog>
    </>
  );
}

function ModList({ version }: { version: PackVersion }) {
  const ids = useMemo(() => [...new Set(version.dependencies.flatMap((d) => (d.project_id ? [d.project_id] : [])))], [version]);
  const external = version.dependencies.filter((d) => !d.project_id && d.file_name).map((d) => d.file_name!);
  const mods = useQuery({ queryKey: ["projects", ids], queryFn: () => getProjectsChunked(ids), enabled: ids.length > 0 });

  if (mods.isError) return <Banner message={`Could not load the mod list: ${errorMessage(mods.error)}`} onRetry={() => mods.refetch()} />;
  if (ids.length && !mods.data) return <div className="mod-grid">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" style={{ height: 56 }} />)}</div>;
  return (
    <>
      <p className="muted small">
        Contents of version <span className="mono">{version.version_number}</span>.
      </p>
      <div className="mod-grid">
        {mods.data?.map((m) => (
          <button key={m.id} className="mod-cell" title={m.description} onClick={() => openUrl(`https://modrinth.com/${m.project_type}/${m.slug}`)}>
            <span className="pack-icon">{m.icon_url ? <img src={m.icon_url} alt="" loading="lazy" /> : <Icon name="extension" />}</span>
            <span className="mod-cell-text">
              <b>{m.title}</b>
              <span>{m.project_type === "mod" ? m.description : m.project_type.replace("resourcepack", "resource pack")}</span>
            </span>
          </button>
        ))}
        {external.map((f) => (
          <div key={f} className="mod-cell">
            <span className="pack-icon"><Icon name="draft" /></span>
            <span className="mod-cell-text"><b>{f}</b><span>Not hosted on Modrinth</span></span>
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
    <div className="versions">
      {versions.map((v) => {
        const on = v.id === selected?.id;
        return (
          <div key={v.id} className={`version ${on ? "on" : ""}`}>
            <button className="version-head" aria-expanded={on} onClick={() => onSelect(v)}>
              <span className={`vtype ${v.version_type}`} title={v.version_type}>{v.version_type[0].toUpperCase()}</span>
              <span className="version-name">
                <b>{v.version_number}</b>
                <span>{v.name}</span>
              </span>
              <span className="chip tag">{v.game_versions.join(", ")}</span>
              <span className="chip">{v.loaders.map((l) => LOADER_NAME[l] ?? l).join(", ")}</span>
              <span className="version-date">{dateLabel(v.date_published)}</span>
              {on && <Icon name="check_circle" fill className="version-check" />}
            </button>
            {on && (
              <div className="version-body">
                {v.changelog?.trim() ? <Markdown source={v.changelog} /> : <p className="muted small">No changelog for this version.</p>}
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
    <div className="text-skeleton">
      {[92, 100, 76, 0, 100, 88, 64].map((w, i) => (w ? <div key={i} className="skeleton" style={{ width: `${w}%` }} /> : <span key={i} />))}
    </div>
  );
}
