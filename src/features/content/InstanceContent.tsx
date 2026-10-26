import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { launcher } from "@/api/launcher";
import { sources, type Hit, type SourceInfo } from "@/api/sources";
import { Banner, Button, Chip, ConfirmDialog, EmptyState, Icon, IconButton, Pill, PillGroup, SearchInput, Select, Skeleton, Switch, Tab, Tabs, toast } from "@/components/ui";
import { InstanceSettingsPane } from "@/features/instances/InstanceSettings";
import { Screenshots } from "@/features/screenshots/Screenshots";
import { Worlds } from "@/features/worlds/Worlds";
import { useDebounced } from "@/hooks/useDebounced";
import { useFavorites, usePlugins, useSource } from "@/hooks/useSource";
import { cx } from "@/lib/cx";
import { compact, errorMessage, megabytes, plural } from "@/lib/format";
import { pluginBase } from "@/plugins/bridge";
import { useBlobUrl } from "@/hooks/useBlobUrl";
import { PluginFrame } from "@/plugins/PluginHost";
import { SourcePicker } from "@/plugins/SourcePicker";
import { clearInstanceTabFocus, useInstanceTabFocus } from "@/store/instanceTab";
import { useLauncher } from "@/store/LauncherContext";
import { useRouteState, useUi, type ContentTarget } from "@/store/UiContext";
import type { ContentKind, Instance } from "@/types";
import s from "./content.module.css";
import { UpdateDialog } from "./UpdateDialog";
import { label, useContent, type ContentItem, type UpdateCandidate } from "./useContent";

const loadContentDetail = () => import("./ContentDetail");
const ContentDetail = lazy(() => loadContentDetail().then((m) => ({ default: m.ContentDetail })));

interface KindInfo {
  label: string;
  /** Lower-case noun for sentences. */
  noun: string;
  icon: string;
  folder: string;
}

const KINDS: Record<ContentKind, KindInfo> = {
  mod: {
    label: "Mods",
    noun: "mods",
    icon: "extension",
    folder: "mods",
  },
  resourcepack: {
    label: "Resource packs",
    noun: "resource packs",
    icon: "texture",
    folder: "resourcepacks",
  },
  shader: {
    label: "Shaders",
    noun: "shaders",
    icon: "wb_twilight",
    folder: "shaderpacks",
  },
};
const ORDER: ContentKind[] = ["mod", "resourcepack", "shader"];
/** Iris, the Fabric/Quilt shader loader, on Modrinth. */
const IRIS = { source: "modrinth", project: "YL57xq9U" };

/** Mods, resource packs, shaders and screenshots of one instance: what is installed, and a content source to add more. */
export function InstanceContent({ instance }: { instance: Instance }) {
  const modded = instance.loader !== "vanilla";
  // `plugin:<id>:<tab>` = a tab a plugin contributes.
  const [tab, setTab] = useRouteState<ContentKind | "worlds" | "screenshots" | "settings" | `plugin:${string}`>("instance.tab", modded ? "mod" : "resourcepack");
  const kind = tab === "worlds" || tab === "screenshots" || tab === "settings" || tab.startsWith("plugin:") ? "mod" : (tab as ContentKind);
  const pluginTabs = (usePlugins().data ?? []).filter((p) => p.enabled).flatMap((p) => p.instanceTabs.map((t) => ({ plugin: p, tab: t, key: `plugin:${p.id}:${t.id}` as const })));
  const openPluginTab = pluginTabs.find((t) => t.key === tab);
  // A header button or the crash notice asked for a plugin tab.
  const focus = useInstanceTabFocus(instance.id);
  useEffect(() => {
    if (!focus) return;
    setTab(focus);
    clearInstanceTabFocus();
  }, [focus, setTab]);
  const content = {
    mod: useContent(instance, "mod", tab === "mod" || tab === "shader"),
    resourcepack: useContent(instance, "resourcepack", tab === "resourcepack"),
    shader: useContent(instance, "shader", tab === "shader"),
  };
  const current = content[kind];
  const source = useSource();
  const route = useUi((st) => st.route);
  const navigate = useUi((st) => st.navigate);
  const back = useUi((st) => st.back);
  const needsLoader = kind !== "resourcepack" && !modded;
  const irisMissing =
    kind === "shader" && (instance.loader === "fabric" || instance.loader === "quilt") && source?.id === IRIS.source && !!content.mod.items && !content.mod.identifying && !content.mod.installedProjects.has(IRIS.project);

  const openContent = route.content?.instanceId === instance.id && source && route.content.source === source.id ? route.content : null;

  const openProject = useCallback(
    (target: ContentTarget) => {
      navigate(route.view, { instance: route.instance, content: target });
    },
    [navigate, route.view, route.instance]
  );

  return (
    <div>
      {openContent && source && (
        <Suspense>
          <ContentDetail
            source={source}
            target={openContent}
            instance={instance}
            content={content[openContent.kind]}
            onBack={back}
            onOpenProject={openProject}
          />
        </Suspense>
      )}
      <div hidden={!!openContent} onPointerOver={loadContentDetail} onFocus={loadContentDetail}>
        <Tabs label="Instance content">
          {ORDER.map((k) => (
            <Tab key={k} selected={tab === k} onSelect={() => setTab(k)} icon={KINDS[k].icon} count={content[k].items?.length ?? ""}>
              {KINDS[k].label}
            </Tab>
          ))}
          <Tab selected={tab === "worlds"} onSelect={() => setTab("worlds")} icon="public">
            Worlds
          </Tab>
          <Tab selected={tab === "screenshots"} onSelect={() => setTab("screenshots")} icon="photo_camera">
            Screenshots
          </Tab>
          <Tab selected={tab === "settings"} onSelect={() => setTab("settings")} icon="tune">
            Settings
          </Tab>
          {pluginTabs.map((t) => (
            <Tab key={t.key} selected={tab === t.key} onSelect={() => setTab(t.key)} icon={t.tab.icon}>
              {t.tab.title}
            </Tab>
          ))}
        </Tabs>

        {openPluginTab ? (
          <PluginFrame
            key={`${openPluginTab.key}/${instance.id}`}
            plugin={openPluginTab.plugin.id}
            instances={openPluginTab.plugin.permissions.instances}
            src={`${pluginBase}${openPluginTab.plugin.id}/${openPluginTab.tab.entry}?instance=${encodeURIComponent(instance.id)}`}
            title={openPluginTab.tab.title}
            className={s.pluginTab}
          />
        ) : tab.startsWith("plugin:") ? (
          <EmptyState icon="extension_off">This plugin tab is not available.</EmptyState>
        ) : tab === "settings" ? (
          <InstanceSettingsPane instance={instance} />
        ) : tab === "worlds" ? (
          <Worlds instance={instance} />
        ) : tab === "screenshots" ? (
          <Screenshots instanceId={instance.id} />
        ) : needsLoader ? (
          <EmptyState icon={KINDS[kind].icon}>
            Vanilla can't load {KINDS[kind].noun}. Create a modded instance to use them.
          </EmptyState>
        ) : (
          <>
            {irisMissing && <IrisNotice instance={instance} onInstalled={content.mod.reload} />}
            <div className={s.contentSplit}>
              <InstalledPane
                key={kind}
                instance={instance}
                kind={kind}
                content={current}
                source={source ?? undefined}
                onOpenProject={openProject}
              />
              {source ? (
                <BrowsePane
                  key={`${source.id}-${kind}`}
                  source={source}
                  instance={instance}
                  kind={kind}
                  installed={current.installedProjects}
                  onInstalled={current.reload}
                  onOpenProject={openProject}
                />
              ) : (
                <EmptyState icon="extension_off">Turn on a content source in Settings → Plugins to add {KINDS[kind].noun}.</EmptyState>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function IrisNotice({ instance, onInstalled }: { instance: Instance; onInstalled(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const install = () => {
    setBusy(true);
    setError("");
    sources
      .installContent(IRIS.source, instance.id, "mod", IRIS.project)
      .then(onInstalled, (e) => setError(`Could not install Iris: ${errorMessage(e)}`))
      .finally(() => setBusy(false));
  };
  return (
    <div className={s.contentNotice} role="status">
      <Icon name={error ? "error" : "info"} />
      <span>{error || "Shaders need the Iris mod (with Sodium). Without it this folder is ignored."}</span>
      <Button variant="primary" size="sm" icon="download" loading={busy} onClick={install}>
        Install Iris
      </Button>
    </div>
  );
}

function InstalledPane({
  instance,
  kind,
  content,
  source,
  onOpenProject,
}: {
  instance: Instance;
  kind: ContentKind;
  content: ReturnType<typeof useContent>;
  source?: SourceInfo;
  onOpenProject(target: ContentTarget): void;
}) {
  const refresh = useLauncher((st) => st.refresh);
  // The game rewrites options.txt and Iris' config on exit, and Windows locks loaded jars.
  const running = useLauncher((st) => st.snapshot?.running.includes(instance.id) ?? false);
  const info = KINDS[kind];
  const sourceName = source?.name;
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<ContentItem | null>(null);
  const [reviewing, setReviewing] = useState<UpdateCandidate[] | null>(null);
  const { items, updatableCount, updatingAll, busyFiles } = content;

  const act = (action: Promise<unknown>) =>
    action
      .then(() => setError(""))
      .catch((e) => setError(errorMessage(e)))
      .finally(() => {
        content.reload();
        refresh();
      });

  const handleUpdateAll = async (picked: UpdateCandidate[]) => {
    setReviewing(null);
    setError("");
    try {
      const count = await content.updateAll(new Set(picked.map((c) => c.file)));
      if (count > 0) toast(`Updated ${plural(count, info.noun.replace(/s$/, ""))}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const q = filter.trim().toLowerCase();
  const shown = (items ?? []).filter((i) => !q || `${label(i)} ${i.file}`.toLowerCase().includes(q));
  const enabled = items?.filter((i) => i.enabled).length ?? 0;

  return (
    <section className={s.cpane} aria-label={`Installed ${info.noun}`}>
      <div className={s.cpaneHead}>
        <div className={s.cpaneTitle}>
          <h3>Installed</h3>
          {items && (
            <span className="mono">
              {enabled}
              {enabled !== items.length && ` / ${items.length}`}
            </span>
          )}
          {content.identifying && (
            <span className={s.identifying}>
              <Icon name="progress_activity" spin />
              Matching with {sourceName}
            </span>
          )}
          <div className={s.headActions}>
            {updatableCount > 0 && (
              <Button
                variant="primary"
                size="sm"
                icon="upgrade"
                loading={updatingAll}
                disabled={running}
                onClick={() => setReviewing(content.candidates)}
              >
                Update all ({updatableCount})
              </Button>
            )}
            <UpdateDialog candidates={reviewing} onClose={() => setReviewing(null)} onConfirm={handleUpdateAll} />
            <IconButton icon="folder_open" label={`Open ${info.folder} folder`} onClick={() => act(launcher.openInstanceDir(instance.id, info.folder))} />
          </div>
        </div>
        {!!items?.length && (
          <SearchInput label={`Filter installed ${info.noun}`} placeholder={`Filter ${info.noun}`} value={filter} onChange={setFilter} />
        )}
        {running && <span className={s.identifying}>Close the game to change installed {info.noun}.</span>}
        {(error || content.error) && <Banner message={error || errorMessage(content.error)} onDismiss={() => setError("")} />}
      </div>

      <fieldset className={s.cpaneList} disabled={running}>
        {!items ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className={s.listSkeleton} height={52} />)
        ) : !items.length ? (
          <EmptyState icon={info.icon}>No {info.noun} yet. Find some on the right.</EmptyState>
        ) : !shown.length ? (
          <EmptyState icon="search_off">Nothing matches “{filter}”.</EmptyState>
        ) : (
          shown.map((i) => {
            const isBusy = busyFiles.has(i.file);
            const canOpen = !!i.project && !!source;
            const openDetail = () => {
              if (!i.project || !source) return;
              onOpenProject({
                source: source.id,
                kind,
                instanceId: instance.id,
                project: {
                  id: i.project.id,
                  title: i.project.title,
                  description: i.project.description,
                  iconUrl: i.project.iconUrl,
                },
              });
            };
            return (
              <div key={i.file} className={cx(s.citem, !i.enabled && s.off)}>
                {canOpen ? (
                  <button type="button" className={s.citemMainBtn} onClick={openDetail} title={`Open ${label(i)} page`}>
                    <ItemIcon item={i} instanceId={instance.id} kind={kind} />
                    <div className={s.citemText}>
                      <div className={s.citemName}>
                        <b>{label(i)}</b>
                        {!i.enabled && <Chip className={s.smallChip}>Disabled</Chip>}
                      </div>
                      <span className={cx(s.citemSub, "mono")} title={i.file}>
                        {i.versionNumber && <>{i.versionNumber} · </>}
                        {megabytes(i.size)}
                      </span>
                    </div>
                  </button>
                ) : (
                  <div className={s.citemMainStatic}>
                    <ItemIcon item={i} instanceId={instance.id} kind={kind} />
                    <div className={s.citemText}>
                      <div className={s.citemName}>
                        <b title={i.project?.description}>{label(i)}</b>
                        {!i.enabled && <Chip className={s.smallChip}>Disabled</Chip>}
                      </div>
                      <span className={cx(s.citemSub, "mono")} title={i.file}>
                        {i.versionNumber && <>{i.versionNumber} · </>}
                        {megabytes(i.size)}
                        {!i.project && !content.identifying && sourceName && ` · not on ${sourceName}`}
                      </span>
                    </div>
                  </div>
                )}

                <div className={s.citemActions}>
                  {i.hasUpdate && i.latestVersion && (
                    <Button
                      size="sm"
                      icon="upgrade"
                      className={s.updateChipBtn}
                      loading={isBusy}
                      title={`Update to ${i.latestVersion.number}`}
                      aria-label={`Update ${label(i)} to ${i.latestVersion.number}`}
                      onClick={() =>
                        content
                          .updateItem(i)
                          .then(() => toast(`Updated ${label(i)} to ${i.latestVersion!.number}`))
                          .catch((e) => setError(errorMessage(e)))
                      }
                    >
                      {i.latestVersion.number}
                    </Button>
                  )}

                  {i.versions && i.versions.length > 0 && (
                    <Select
                      label={`Version of ${label(i)}`}
                      className={cx(s.versionSelect, "mono")}
                      value={i.currentVersion?.id ?? ""}
                      disabled={isBusy}
                      placeholder={i.versionNumber ?? "Version"}
                      onChange={(vid) =>
                        content
                          .switchVersion(i, vid)
                          .then(() => {
                            const picked = i.versions?.find((v) => v.id === vid);
                            toast(`Switched ${label(i)} to ${picked?.number ?? "selected version"}`);
                          })
                          .catch((e) => setError(errorMessage(e)))
                      }
                      options={i.versions.map((v) => ({
                        value: v.id,
                        label: v.number,
                        hint: v.id === i.currentVersion?.id ? "current" : v.channel !== "release" ? v.channel : undefined,
                      }))}
                    />
                  )}

                  <IconButton icon="delete" label={`Remove ${label(i)}`} title="Remove" variant="danger" className={s.reveal} onClick={() => setRemoving(i)} />
                  <Switch label={`${i.enabled ? "Disable" : "Enable"} ${label(i)}`} checked={i.enabled} onChange={() => act(launcher.toggleContent(instance.id, kind, i.file))} />
                </div>
              </div>
            );
          })
        )}
      </fieldset>

      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing ? label(removing) : ""}?`}
        confirmLabel="Remove"
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) act(launcher.deleteContent(instance.id, kind, removing.file));
          setRemoving(null);
        }}
      >
        <span className="mono">{removing?.file}</span> is deleted from the {info.folder} folder.
      </ConfirmDialog>
    </section>
  );
}

function ItemIcon({ item, instanceId, kind }: { item: ContentItem; instanceId: string; kind: ContentKind }) {
  const jar = useBlobUrl(kind === "mod" && !item.project?.iconUrl ? `${instanceId}/${item.file}` : null, () => launcher.modIcon(instanceId, item.file));
  const src = item.project?.iconUrl ?? jar;
  // The jar icon is tried before the source answers; remember a failure per URL so the source's one still shows.
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className={s.citemIcon}>
      <Icon name={KINDS[kind].icon} />
      {src && src !== failed && <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} />}
    </span>
  );
}

type InstallState = "installing" | "installed" | { error: string };

function BrowsePane(p: {
  source: SourceInfo;
  instance: Instance;
  kind: ContentKind;
  installed: Set<string>;
  onInstalled(): void;
  onOpenProject(target: ContentTarget): void;
}) {
  const { source, instance, kind, installed, onInstalled, onOpenProject } = p;
  const info = KINDS[kind];
  const categories = [{ id: "", label: "All" }, ...(source.categories[kind] ?? [])];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const favorites = useFavorites(source.id, kind);
  const [installs, setInstalls] = useState<Record<string, InstallState>>({});
  const debounced = useDebounced(query.trim(), 300);
  const { version, loader } = instance;
  // Read at click time so `install` stays stable while identification is still filling the set.
  const installedRef = useRef(installed);
  installedRef.current = installed;

  const hits = useQuery({
    queryKey: ["browse", source.id, kind, version, loader, debounced, category],
    queryFn: () =>
      sources
        .search(source.id, { kind, query: debounced, gameVersion: version, loader, categories: category ? [category] : [], limit: 30 })
        .then((page) => page.hits),
    placeholderData: keepPreviousData,
  });

  // Stable so memoized cards skip re-rendering while the user types.
  const install = useCallback(
    async (projectId: string) => {
      setInstalls((s) => ({ ...s, [projectId]: "installing" }));
      try {
        // Dependencies already present (any version) are skipped instead of landing as a second jar.
        await sources.installContent(source.id, instance.id, kind, projectId, [...installedRef.current]);
        setInstalls((s) => ({ ...s, [projectId]: "installed" }));
        onInstalled();
      } catch (e) {
        setInstalls((s) => ({ ...s, [projectId]: { error: errorMessage(e) } }));
      }
    },
    [source.id, instance.id, kind, onInstalled]
  );

  const openHit = useCallback(
    (hit: Hit) => {
      onOpenProject({
        source: source.id,
        kind,
        instanceId: instance.id,
        project: {
          id: hit.id,
          title: hit.title,
          description: hit.description,
          iconUrl: hit.iconUrl,
          author: hit.author,
          downloads: hit.downloads,
          follows: hit.follows,
          updated: hit.updated,
          bannerUrl: hit.bannerUrl,
          color: hit.color,
        },
      });
    },
    [onOpenProject, source.id, kind, instance.id]
  );

  const q = debounced.toLowerCase();
  const shownFavorites = favorites.hits.filter((h) => !q || h.title.toLowerCase().includes(q));
  const card = (h: Hit) => (
    <ResultCard
      key={h.id}
      hit={h}
      icon={info.icon}
      state={installed.has(h.id) ? "installed" : installs[h.id]}
      favorite={favorites.ids.has(h.id)}
      onOpen={openHit}
      onInstall={install}
      onFavorite={favorites.toggle}
    />
  );

  return (
    <section className={s.cpane} aria-label={`Add ${info.noun} from ${source.name}`}>
      <div className={s.cpaneHead}>
        <div className={s.cpaneTitle}>
          <h3>Add from {source.name}</h3>
          <span className="mono">{version}</span>
        </div>
        <SourcePicker />
        <SearchInput icon="travel_explore" label={`Search ${info.noun} on ${source.name}`} placeholder={`Search ${info.noun}`} value={query} onChange={setQuery} />
        <PillGroup label="Category" wrap className={s.cats}>
          <Pill pressed={favOnly} icon="star" count={favorites.hits.length} onClick={() => setFavOnly(true)}>
            Favorites
          </Pill>
          {categories.map((c) => (
            <Pill key={c.id} pressed={!favOnly && category === c.id} onClick={() => (setFavOnly(false), setCategory(c.id))}>
              {c.label}
            </Pill>
          ))}
        </PillGroup>
      </div>

      <div className={cx(s.cpaneList, !favOnly && hits.isPlaceholderData && s.stale)}>
        {favOnly ? (
          !shownFavorites.length ? (
            <EmptyState icon="star">{debounced ? `No favorite ${info.noun} match “${debounced}”.` : `No favorite ${info.noun} yet. Star some from the search.`}</EmptyState>
          ) : (
            shownFavorites.map((h) => card(h))
          )
        ) : hits.isError ? (
          <Banner message={`${source.name} search failed: ${errorMessage(hits.error)}`} onRetry={() => hits.refetch()} />
        ) : !hits.data ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className={s.listSkeleton} height={84} />)
        ) : !hits.data.length ? (
          <EmptyState icon="search_off">No {info.noun} for Minecraft {version}{debounced && ` match “${debounced}”`}.</EmptyState>
        ) : (
          hits.data.map((h) => card(h))
        )}
      </div>
    </section>
  );
}

const ResultCard = memo(function ResultCard(p: {
  hit: Hit;
  icon: string;
  state?: InstallState;
  favorite: boolean;
  onOpen(hit: Hit): void;
  onInstall(id: string): void;
  onFavorite(hit: Hit): void;
}) {
  const { hit, icon, state, favorite, onOpen, onInstall, onFavorite } = p;
  const failed = typeof state === "object";
  return (
    <div className={s.cresult}>
      <button type="button" className={s.cresultMainBtn} onClick={() => onOpen(hit)}>
        <span className={cx(s.citemIcon, s.big)}>{hit.iconUrl ? <img src={hit.iconUrl} alt="" loading="lazy" /> : <Icon name={icon} />}</span>
        <div className={s.citemText}>
          <div className={s.citemName}>
            <b>{hit.title}</b>
            <span className={s.by}>by {hit.author}</span>
          </div>
          <p className={s.cresultDesc}>{hit.description}</p>
          <span className={cx(s.citemSub, "mono")}><Icon name="download" />{compact(hit.downloads)}</span>
        </div>
      </button>
      <IconButton
        icon="star"
        fill={favorite}
        aria-pressed={favorite}
        label={favorite ? `Remove ${hit.title} from favorites` : `Add ${hit.title} to favorites`}
        title={favorite ? "Remove from favorites" : "Add to favorites"}
        className={cx(s.cresultBtn, !favorite && s.reveal)}
        onClick={() => onFavorite(hit)}
      />
      {state === "installed" ? (
        <Button size="sm" icon="check" className={cx(s.cresultBtn, s.installed)} disabled>
          Installed
        </Button>
      ) : (
        <Button
          size="sm"
          icon={failed ? "refresh" : "download"}
          className={s.cresultBtn}
          loading={state === "installing"}
          title={failed ? state.error : undefined}
          aria-label={`Install ${hit.title}`}
          onClick={() => onInstall(hit.id)}
        >
          {state === "installing" ? "Installing" : failed ? "Retry" : "Install"}
        </Button>
      )}
    </div>
  );
});
