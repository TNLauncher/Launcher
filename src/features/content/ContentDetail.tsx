import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";
import { launcher } from "@/api/launcher";
import { primaryFile, sources, type GalleryImage, type Hit, type Project, type SourceInfo, type Version } from "@/api/sources";
import { useBackLabel } from "@/components/layout/Sidebar";
import { Banner, Button, Chip, ConfirmDialog, Dialog, EmptyState, Field, Icon, IconButton, Select, Skeleton, Switch, Tab, Tabs, toast } from "@/components/ui";
import { Markdown } from "@/components/ui/Markdown";
import { packColor } from "@/features/modpacks/ModpacksView";
import s from "@/features/modpacks/modpacks.module.css";
import { useFavorites } from "@/hooks/useSource";
import { cx } from "@/lib/cx";
import { ago, compact, errorMessage, LOADERS, loaderLabel, megabytes } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { useRouteState, type ContentTarget } from "@/store/UiContext";
import type { ContentKind, Instance } from "@/types";
import cs from "./content.module.css";
import { fetchCompatibleVersions, label, useContent, type ContentItem } from "./useContent";

type Section = "description" | "gallery" | "versions";
const LOADER_NAME: Record<string, string> = LOADERS;
const KIND_ICON: Record<ContentKind, string> = { mod: "extension", resourcepack: "texture", shader: "wb_twilight" };
const KIND_NOUN: Record<ContentKind, string> = { mod: "mod", resourcepack: "resource pack", shader: "shader" };

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });

/** Full in-app page for a mod, resource pack, or shader inside an instance. */
export function ContentDetail({
  source,
  target,
  instance,
  content,
  onBack,
  onOpenProject,
}: {
  source: SourceInfo;
  target: ContentTarget;
  instance: Instance;
  content: ReturnType<typeof useContent>;
  onBack(): void;
  onOpenProject?(target: ContentTarget): void;
}) {
  const { kind, project: summary } = target;
  const id = summary.id;
  const project = useQuery({ queryKey: ["project", source.id, id], queryFn: () => sources.project(source.id, id) });
  const versions = useQuery({
    queryKey: ["content-versions", source.id, id, kind, instance.version, instance.loader],
    queryFn: () => fetchCompatibleVersions(source.id, id, kind, instance.version, instance.loader),
  });
  const [tab, setTab] = useRouteState<Section>("content.tab", "description");
  const backLabel = useBackLabel();
  const [versionId, setVersionId] = useState("");
  const top = useRef<HTMLDivElement>(null);
  const favorites = useFavorites(source.id, kind);
  const favorite = favorites.ids.has(id);

  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" });
    setVersionId("");
  }, [id]);

  const installedItem = useMemo(() => content.items?.find((i) => i.project?.id === id), [content.items, id]);
  const all = versions.data ?? [];
  const defaultVersion = installedItem?.currentVersion ?? all.find((v) => v.channel === "release") ?? all[0];
  const selectedVersion = all.find((v) => v.id === versionId) ?? defaultVersion;

  const gallery = useMemo(
    () => [...(project.data?.gallery ?? [])].sort((a, b) => Number(b.featured) - Number(a.featured)),
    [project.data]
  );
  const title = project.data?.title ?? summary.title;
  const description = project.data?.description ?? summary.description;
  const iconUrl = project.data?.iconUrl ?? summary.iconUrl;
  const color = project.data?.color ?? summary.color ?? null;
  const banner = summary.bannerUrl ?? gallery[0]?.url;

  const favHit: Hit = {
    id,
    slug: id,
    title,
    author: summary.author ?? "",
    description,
    iconUrl,
    downloads: summary.downloads ?? 0,
    follows: summary.follows ?? 0,
    categories: [],
    gameVersions: [instance.version],
    updated: summary.updated ?? project.data?.published ?? new Date().toISOString(),
    bannerUrl: banner ?? null,
    color,
  };

  return (
    <div className={s.packPage} style={{ "--pack": packColor(color) } as React.CSSProperties}>
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
              onClick={() => favorites.toggle(favHit)}
            />
          </div>
          <div className={s.packHeroMain}>
            <span className={cx(s.packIcon, s.big)}>
              {iconUrl ? <img src={iconUrl} alt="" /> : <Icon name={KIND_ICON[kind]} />}
            </span>
            <div className={s.packHeroText}>
              <h1>{title}</h1>
              <p>{description}</p>
              <div className={s.packMeta}>
                {summary.author && (
                  <span className={s.stat}>
                    by <b>{summary.author}</b>
                  </span>
                )}
                {summary.downloads != null && (
                  <span className={cx(s.stat, "mono")}>
                    <Icon name="download" />
                    {compact(summary.downloads)}
                  </span>
                )}
                {summary.follows != null && (
                  <span className={cx(s.stat, "mono")}>
                    <Icon name="favorite" />
                    {compact(summary.follows)}
                  </span>
                )}
                {summary.updated && (
                  <span className={s.stat}>
                    <Icon name="update" />
                    Updated {ago(summary.updated)}
                  </span>
                )}
                <Chip variant="tag">{instance.version}</Chip>
                <Chip>{loaderLabel(instance)}</Chip>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={s.packColumns}>
        <div className={s.packContent}>
          <Tabs label="Project sections">
            <Tab selected={tab === "description"} onSelect={() => setTab("description")}>
              Description
            </Tab>
            {gallery.length > 0 && (
              <Tab selected={tab === "gallery"} onSelect={() => setTab("gallery")} count={gallery.length}>
                Gallery
              </Tab>
            )}
            <Tab selected={tab === "versions"} onSelect={() => setTab("versions")} count={all.length || undefined}>
              Versions
            </Tab>
          </Tabs>
          <div role="tabpanel">
            {project.isError ? (
              <Banner message={`Could not load this ${KIND_NOUN[kind]}: ${errorMessage(project.error)}`} onRetry={() => project.refetch()} />
            ) : tab === "description" ? (
              project.data ? <Markdown source={project.data.body} /> : <TextSkeleton />
            ) : tab === "gallery" ? (
              <Gallery images={gallery} />
            ) : (
              <VersionList
                versions={all}
                loading={versions.isPending}
                installedVersionId={installedItem?.currentVersion?.id}
                selected={selectedVersion}
                onSelect={(v) => setVersionId(v.id)}
              />
            )}
          </div>
        </div>

        <aside className={s.packSide}>
          <ManageCard
            source={source}
            kind={kind}
            projectId={id}
            projectTitle={title}
            instance={instance}
            content={content}
            installedItem={installedItem}
            versions={all}
            loading={versions.isPending}
            error={versions.isError ? errorMessage(versions.error) : ""}
            onRetry={() => versions.refetch()}
            selectedVersion={selectedVersion}
            onSelectVersion={setVersionId}
          />
          {selectedVersion && kind === "mod" && (
            <DependenciesCard
              source={source}
              instance={instance}
              version={selectedVersion}
              installedProjects={content.installedProjects}
              onOpenProject={onOpenProject}
            />
          )}
          {project.data && <About project={project.data} />}
        </aside>
      </div>
    </div>
  );
}

function ManageCard(p: {
  source: SourceInfo;
  kind: ContentKind;
  projectId: string;
  projectTitle: string;
  instance: Instance;
  content: ReturnType<typeof useContent>;
  installedItem?: ContentItem;
  versions: Version[];
  loading: boolean;
  error: string;
  onRetry(): void;
  selectedVersion?: Version;
  onSelectVersion(id: string): void;
}) {
  const { source, kind, projectId, projectTitle, instance, content, installedItem, versions, selectedVersion, onSelectVersion } = p;
  const refresh = useLauncher((st) => st.refresh);
  const running = useLauncher((st) => st.snapshot?.running.includes(instance.id) ?? false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [removing, setRemoving] = useState(false);

  const latest = versions[0];
  const installedVersion = installedItem?.currentVersion;
  const isSelectedInstalled =
    !!installedItem &&
    !!selectedVersion &&
    (installedVersion
      ? selectedVersion.id === installedVersion.id
      : selectedVersion.number === installedItem.versionNumber ||
        selectedVersion.files.some((f) => f.filename === installedItem.file.replace(/\.disabled$/, "")));

  const file = selectedVersion && primaryFile(selectedVersion);
  const itemBusy = busy || (installedItem ? content.busyFiles.has(installedItem.file) : false);

  const handleInstallOrSwitch = async () => {
    if (!selectedVersion || running) return;
    setBusy(true);
    setActionError("");
    try {
      if (installedItem) {
        await content.switchVersion(installedItem, selectedVersion.id);
        toast(`Switched ${projectTitle} to ${selectedVersion.number}`);
      } else {
        await sources.installContent(source.id, instance.id, kind, projectId, [...content.installedProjects], {
          version: selectedVersion.id,
        });
        await content.reload();
        refresh();
        toast(`Installed ${projectTitle} ${selectedVersion.number}`);
      }
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateLatest = async () => {
    if (!installedItem || !latest || running) return;
    setBusy(true);
    setActionError("");
    try {
      await content.updateItem(installedItem);
      onSelectVersion(latest.id);
      toast(`Updated ${projectTitle} to ${latest.number}`);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async () => {
    if (!installedItem || running) return;
    setActionError("");
    try {
      await launcher.toggleContent(instance.id, kind, installedItem.file);
      await content.reload();
      refresh();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  return (
    <div className={s.sideCard}>
      <div className={cs.detailCardHead}>
        <h2>{installedItem ? "Installed in instance" : "Add to instance"}</h2>
        {installedItem && (
          <Chip variant={installedItem.enabled ? "accent" : "default"}>
            {installedItem.enabled ? "Enabled" : "Disabled"}
          </Chip>
        )}
      </div>

      {p.error ? (
        <Banner message={`Could not load versions: ${p.error}`} onRetry={p.onRetry} />
      ) : !p.loading && !versions.length ? (
        <p className={s.note}>
          No compatible build found for Minecraft {instance.version} ({loaderLabel(instance)}).
        </p>
      ) : (
        <>
          {installedItem?.hasUpdate && latest && (
            <div className={cs.updateCallout}>
              <div className={cs.updateCalloutText}>
                <b>Update available</b>
                <span className="mono">
                  {installedItem.versionNumber ?? installedVersion?.number ?? "Current"} → {latest.number}
                </span>
              </div>
              <Button
                variant="primary"
                size="sm"
                icon="upgrade"
                loading={itemBusy}
                disabled={running}
                onClick={handleUpdateLatest}
              >
                Update
              </Button>
            </div>
          )}

          <Field label="Version" asLabel={false}>
            <Select
              label="Version"
              className={s.sideCardSelect}
              value={selectedVersion?.id ?? ""}
              onChange={onSelectVersion}
              disabled={running || itemBusy}
              placeholder="Loading…"
              options={versions.map((v) => ({
                value: v.id,
                label: v.number,
                hint:
                  v.id === installedVersion?.id
                    ? "installed"
                    : v.channel === "release"
                      ? dateLabel(v.published)
                      : v.channel,
              }))}
            />
          </Field>

          {selectedVersion && (
            <dl className={s.installFacts}>
              <dt>Instance</dt>
              <dd>{instance.name}</dd>
              <dt>Minecraft</dt>
              <dd className="mono">{selectedVersion.gameVersions.join(", ") || instance.version}</dd>
              {selectedVersion.loaders.length > 0 && (
                <>
                  <dt>Loaders</dt>
                  <dd>{selectedVersion.loaders.map((l) => LOADER_NAME[l] ?? l).join(", ")}</dd>
                </>
              )}
              <dt>Released</dt>
              <dd>{dateLabel(selectedVersion.published)}</dd>
              {file && (
                <>
                  <dt>File size</dt>
                  <dd className="mono">{megabytes(file.size)}</dd>
                </>
              )}
            </dl>
          )}

          {selectedVersion && selectedVersion.channel !== "release" && (
            <p className={s.installNote}>
              <Icon name="science" />
              This is a {selectedVersion.channel} build and may be unstable.
            </p>
          )}

          {actionError && <Banner message={actionError} onDismiss={() => setActionError("")} />}

          <Button
            variant={isSelectedInstalled ? "default" : "primary"}
            size="lg"
            icon={isSelectedInstalled ? "check" : installedItem ? "swap_horiz" : "download"}
            className={s.installBtn}
            disabled={!selectedVersion || isSelectedInstalled || running}
            loading={itemBusy}
            onClick={handleInstallOrSwitch}
          >
            {isSelectedInstalled
              ? `Installed (${selectedVersion?.number})`
              : installedItem
                ? `Switch to ${selectedVersion?.number}`
                : `Install ${selectedVersion?.number ?? ""}`}
          </Button>

          {installedItem && (
            <div className={cs.installedControls}>
              <label className={cs.installedToggle}>
                <span>Enabled in game</span>
                <Switch
                  label={`${installedItem.enabled ? "Disable" : "Enable"} ${label(installedItem)}`}
                  checked={installedItem.enabled}
                  disabled={running}
                  onChange={handleToggle}
                />
              </label>
              <Button
                variant="danger"
                size="sm"
                icon="delete"
                disabled={running}
                onClick={() => setRemoving(true)}
              >
                Remove from instance
              </Button>
            </div>
          )}

          {running && <p className={s.note}>Close the game to change or update installed content.</p>}
        </>
      )}

      <ConfirmDialog
        open={removing}
        title={`Remove ${projectTitle}?`}
        confirmLabel="Remove"
        danger
        onCancel={() => setRemoving(false)}
        onConfirm={() => {
          setRemoving(false);
          if (!installedItem) return;
          launcher
            .deleteContent(instance.id, kind, installedItem.file)
            .then(() => {
              content.reload();
              refresh();
              toast(`Removed ${projectTitle}`, "info");
            })
            .catch((e) => setActionError(errorMessage(e)));
        }}
      >
        <span className="mono">{installedItem?.file}</span> will be deleted from the instance.
      </ConfirmDialog>
    </div>
  );
}

function DependenciesCard({
  source,
  instance,
  version,
  installedProjects,
  onOpenProject,
}: {
  source: SourceInfo;
  instance: Instance;
  version: Version;
  installedProjects: Set<string>;
  onOpenProject?(target: ContentTarget): void;
}) {
  const reqIds = useMemo(
    () => [...new Set(version.dependencies.filter((d) => d.kind === "required" && d.projectId).map((d) => d.projectId!))],
    [version]
  );
  const deps = useQuery({
    queryKey: ["projects", source.id, reqIds],
    queryFn: () => sources.projects(source.id, reqIds),
    enabled: reqIds.length > 0,
  });

  if (!reqIds.length || !deps.data?.length) return null;

  return (
    <div className={s.sideCard}>
      <h2>Required dependencies</h2>
      <div className={cs.depList}>
        {deps.data.map((d) => {
          const isInstalled = installedProjects.has(d.id);
          return (
            <button
              key={d.id}
              className={cs.depItem}
              onClick={() =>
                onOpenProject
                  ? onOpenProject({
                      source: source.id,
                      kind: (d.kind === "resourcepack" || d.kind === "shader" ? d.kind : "mod") as ContentKind,
                      instanceId: instance.id,
                      project: { id: d.id, title: d.title, description: d.description, iconUrl: d.iconUrl },
                    })
                  : openUrl(d.url)
              }
            >
              <span className={s.packIcon}>{d.iconUrl ? <img src={d.iconUrl} alt="" loading="lazy" /> : <Icon name="extension" />}</span>
              <span className={cs.depText}>
                <b>{d.title}</b>
                <span>{isInstalled ? "Installed" : "Installed automatically"}</span>
              </span>
              {isInstalled && <Icon name="check_circle" fill className={cs.depCheck} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function About({ project: p }: { project: Project }) {
  return (
    <div className={s.sideCard}>
      <h2>About</h2>
      <dl className={s.installFacts}>
        {p.published && (
          <>
            <dt>Published</dt>
            <dd>{dateLabel(p.published)}</dd>
          </>
        )}
        {p.license && (
          <>
            <dt>License</dt>
            <dd>{p.license}</dd>
          </>
        )}
      </dl>
      <div className={s.sideLinks}>
        {p.links.map((l) => (
          <button key={l.label} className={s.sideLink} onClick={() => openUrl(l.url)}>
            <Icon name={l.icon} />
            {l.label}
          </button>
        ))}
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
            <img src={shown.rawUrl} alt={shown.title ?? ""} />
            <figcaption>
              <div>
                {shown.title && <b>{shown.title}</b>}
                {shown.description && <span>{shown.description}</span>}
              </div>
              <div className={s.lightboxNav}>
                <span className={cx(s.lightboxCount, "mono")}>
                  {(index ?? 0) + 1} / {images.length}
                </span>
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

function VersionList({
  versions,
  loading,
  installedVersionId,
  selected,
  onSelect,
}: {
  versions: Version[];
  loading: boolean;
  installedVersionId?: string;
  selected?: Version;
  onSelect(v: Version): void;
}) {
  if (loading) return <TextSkeleton />;
  if (!versions.length) return <EmptyState icon="history">No compatible versions found.</EmptyState>;
  return (
    <div className={s.versions}>
      {versions.map((v) => {
        const on = v.id === selected?.id;
        const isInstalled = v.id === installedVersionId;
        return (
          <div key={v.id} className={cx(s.version, on && s.on)}>
            <button className={s.versionHead} aria-expanded={on} onClick={() => onSelect(v)}>
              <span className={cx(s.vtype, s[v.channel])} title={v.channel}>
                {v.channel[0].toUpperCase()}
              </span>
              <span className={s.versionName}>
                <b>{v.number}</b>
                <span>{v.name}</span>
              </span>
              {isInstalled && <Chip variant="accent">Installed</Chip>}
              <Chip variant="tag" className={s.versionTag}>
                {v.gameVersions.join(", ")}
              </Chip>
              {v.loaders.length > 0 && <Chip>{v.loaders.map((l) => LOADER_NAME[l] ?? l).join(", ")}</Chip>}
              <span className={s.versionDate}>{dateLabel(v.published)}</span>
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
