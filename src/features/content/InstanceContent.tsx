import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { memo, useCallback, useRef, useState } from "react";
import { launcher } from "@/api/launcher";
import { installContent, searchContent, type ModHit } from "@/api/modrinth";
import { Banner } from "@/components/ui/Banner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Switch } from "@/components/ui/Switch";
import { useDebounced } from "@/hooks/useDebounced";
import { compact, errorMessage, megabytes } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import type { ContentKind, Instance } from "@/types";
import { label, useContent, type ContentItem } from "./useContent";
import "./content.css";

interface KindInfo {
  label: string;
  /** Lower-case noun for sentences. */
  noun: string;
  icon: string;
  folder: string;
  categories: [string, string][];
}

const KINDS: Record<ContentKind, KindInfo> = {
  mod: {
    label: "Mods",
    noun: "mods",
    icon: "extension",
    folder: "mods",
    categories: [["", "All"], ["optimization", "Performance"], ["utility", "Utility"], ["worldgen", "Worldgen"], ["decoration", "Decoration"], ["library", "Libraries"]],
  },
  resourcepack: {
    label: "Resource packs",
    noun: "resource packs",
    icon: "texture",
    folder: "resourcepacks",
    categories: [["", "All"], ["vanilla-like", "Vanilla-like"], ["simplistic", "Simplistic"], ["realistic", "Realistic"], ["themed", "Themed"], ["tweaks", "Tweaks"], ["utility", "Utility"]],
  },
  shader: {
    label: "Shaders",
    noun: "shaders",
    icon: "wb_twilight",
    folder: "shaderpacks",
    categories: [["", "All"], ["vanilla-like", "Vanilla-like"], ["semi-realistic", "Semi-realistic"], ["realistic", "Realistic"], ["fantasy", "Fantasy"], ["cartoon", "Cartoon"], ["low", "Lightweight"]],
  },
};
const ORDER: ContentKind[] = ["mod", "resourcepack", "shader"];
/** Iris: the Fabric/Quilt shader loader. */
const IRIS = "YL57xq9U";

/** Mods, resource packs and shaders of one instance: what is installed, and Modrinth to add more. */
export function InstanceContent({ instance }: { instance: Instance }) {
  const modded = instance.loader !== "vanilla";
  const [kind, setKind] = useState<ContentKind>(modded ? "mod" : "resourcepack");
  const content = { mod: useContent(instance.id, "mod"), resourcepack: useContent(instance.id, "resourcepack"), shader: useContent(instance.id, "shader") };
  const current = content[kind];
  const needsLoader = kind !== "resourcepack" && !modded;
  const irisMissing = kind === "shader" && modded && !!content.mod.items && !content.mod.identifying && !content.mod.installedProjects.has(IRIS);

  return (
    <div className="content">
      <div className="tabs" role="tablist" aria-label="Instance content">
        {ORDER.map((k) => (
          <button key={k} role="tab" className="tab" aria-selected={kind === k} onClick={() => setKind(k)}>
            <Icon name={KINDS[k].icon} />
            {KINDS[k].label}
            <span className="mono">{content[k].items?.length ?? ""}</span>
          </button>
        ))}
      </div>

      {needsLoader ? (
        <EmptyState icon={KINDS[kind].icon}>
          Vanilla can't load {KINDS[kind].noun}. Create a Fabric or Quilt instance to use them.
        </EmptyState>
      ) : (
        <>
          {irisMissing && <IrisNotice instance={instance} onInstalled={content.mod.reload} />}
          <div className="content-split">
            <InstalledPane key={kind} instance={instance} kind={kind} content={current} />
            <BrowsePane key={`${kind}-browse`} instance={instance} kind={kind} installed={current.installedProjects} onInstalled={current.reload} />
          </div>
        </>
      )}
    </div>
  );
}

function IrisNotice({ instance, onInstalled }: { instance: Instance; onInstalled(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const install = () => {
    setBusy(true);
    setError("");
    installContent(IRIS, instance, "mod")
      .then(onInstalled, (e) => setError(`Could not install Iris: ${errorMessage(e)}`))
      .finally(() => setBusy(false));
  };
  return (
    <div className="content-notice" role="status">
      <Icon name={error ? "error" : "info"} />
      <span>{error || "Shaders need the Iris mod (with Sodium). Without it this folder is ignored."}</span>
      <button className="btn small primary" disabled={busy} onClick={install}>
        <Icon name={busy ? "progress_activity" : "download"} spin={busy} />
        Install Iris
      </button>
    </div>
  );
}

function InstalledPane({ instance, kind, content }: { instance: Instance; kind: ContentKind; content: ReturnType<typeof useContent> }) {
  const { refresh } = useLauncher();
  const info = KINDS[kind];
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<ContentItem | null>(null);
  const { items } = content;

  const act = (action: Promise<void>) =>
    action
      .then(() => setError(""))
      .catch((e) => setError(errorMessage(e)))
      .finally(() => {
        content.reload();
        refresh();
      });

  const q = filter.trim().toLowerCase();
  const shown = (items ?? []).filter((i) => !q || `${label(i)} ${i.file}`.toLowerCase().includes(q));
  const enabled = items?.filter((i) => i.enabled).length ?? 0;

  return (
    <section className="cpane" aria-label={`Installed ${info.noun}`}>
      <div className="cpane-head">
        <div className="cpane-title">
          <h3>Installed</h3>
          {items && (
            <span className="mono">
              {enabled}
              {enabled !== items.length && ` / ${items.length}`}
            </span>
          )}
          {content.identifying && (
            <span className="identifying">
              <Icon name="progress_activity" spin />
              Matching with Modrinth
            </span>
          )}
          <button className="icon-btn" title={`Open ${info.folder} folder`} aria-label={`Open ${info.folder} folder`} onClick={() => act(launcher.openInstanceDir(instance.id, kind))}>
            <Icon name="folder_open" />
          </button>
        </div>
        {!!items?.length && (
          <label className="search">
            <Icon name="search" />
            <input className="input" aria-label={`Filter installed ${info.noun}`} placeholder={`Filter ${info.noun}`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        )}
        {(error || content.error) && <Banner message={error || errorMessage(content.error)} onDismiss={() => setError("")} />}
      </div>

      <div className="cpane-list">
        {!items ? (
          Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ height: 52, flexShrink: 0 }} />)
        ) : !items.length ? (
          <EmptyState icon={info.icon}>No {info.noun} yet. Find some on the right.</EmptyState>
        ) : !shown.length ? (
          <EmptyState icon="search_off">Nothing matches “{filter}”.</EmptyState>
        ) : (
          shown.map((i) => (
            <div key={i.file} className={`citem ${i.enabled ? "" : "off"}`}>
              <ItemIcon item={i} instanceId={instance.id} kind={kind} />
              <div className="citem-text">
                <div className="citem-name">
                  <b title={i.project?.description}>{label(i)}</b>
                  {!i.enabled && <span className="chip">Disabled</span>}
                </div>
                <span className="citem-sub mono" title={i.file}>
                  {i.versionNumber && <>{i.versionNumber} · </>}
                  {megabytes(i.size)}
                  {!i.project && !content.identifying && " · not on Modrinth"}
                </span>
              </div>
              <div className="citem-actions">
                <button className="icon-btn danger" title="Remove" aria-label={`Remove ${label(i)}`} onClick={() => setRemoving(i)}>
                  <Icon name="delete" />
                </button>
                <Switch label={`${i.enabled ? "Disable" : "Enable"} ${label(i)}`} checked={i.enabled} onChange={() => act(launcher.toggleContent(instance.id, kind, i.file))} />
              </div>
            </div>
          ))
        )}
      </div>

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
  const src = item.project?.icon_url ?? (kind === "mod" ? launcher.modIconUrl(instanceId, item.file) : null);
  // The jar icon is tried before Modrinth answers; remember a failure per URL so the Modrinth one still shows.
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className="citem-icon">
      <Icon name={KINDS[kind].icon} />
      {src && src !== failed && <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} />}
    </span>
  );
}

type InstallState = "installing" | "installed" | { error: string };

function BrowsePane({ instance, kind, installed, onInstalled }: { instance: Instance; kind: ContentKind; installed: Set<string>; onInstalled(): void }) {
  const info = KINDS[kind];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [installs, setInstalls] = useState<Record<string, InstallState>>({});
  const debounced = useDebounced(query.trim(), 300);
  const { version, loader } = instance;
  // Read at click time so `install` stays stable while identification is still filling the set.
  const installedRef = useRef(installed);
  installedRef.current = installed;

  const hits = useQuery({
    queryKey: ["browse", kind, version, loader, debounced, category],
    queryFn: () => searchContent({ version, loader }, kind, debounced, category),
    placeholderData: keepPreviousData,
  });

  // Stable so memoized cards skip re-rendering while the user types.
  const install = useCallback(
    async (projectId: string) => {
      setInstalls((s) => ({ ...s, [projectId]: "installing" }));
      try {
        // Dependencies already present (any version) are skipped instead of landing as a second jar.
        await installContent(projectId, instance, kind, new Set([...installedRef.current].filter((id) => id !== projectId)));
        setInstalls((s) => ({ ...s, [projectId]: "installed" }));
        onInstalled();
      } catch (e) {
        setInstalls((s) => ({ ...s, [projectId]: { error: errorMessage(e) } }));
      }
    },
    [instance, kind, onInstalled]
  );

  return (
    <section className="cpane browse" aria-label={`Add ${info.noun} from Modrinth`}>
      <div className="cpane-head">
        <div className="cpane-title">
          <h3>Add from Modrinth</h3>
          <span className="mono">{version}</span>
        </div>
        <label className="search">
          <Icon name="travel_explore" />
          <input className="input" aria-label={`Search ${info.noun} on Modrinth`} placeholder={`Search ${info.noun}`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="pills" role="group" aria-label="Category">
          {info.categories.map(([key, name]) => (
            <button key={key} className="pill" aria-pressed={category === key} onClick={() => setCategory(key)}>
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className={`cpane-list ${hits.isPlaceholderData ? "stale" : ""}`}>
        {hits.isError ? (
          <Banner message={`Modrinth search failed: ${errorMessage(hits.error)}`} onRetry={() => hits.refetch()} />
        ) : !hits.data ? (
          Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ height: 84, flexShrink: 0 }} />)
        ) : !hits.data.length ? (
          <EmptyState icon="search_off">No {info.noun} for Minecraft {version}{debounced && ` match “${debounced}”`}.</EmptyState>
        ) : (
          hits.data.map((h) => (
            <ResultCard key={h.project_id} hit={h} icon={info.icon} state={installed.has(h.project_id) ? "installed" : installs[h.project_id]} onInstall={install} />
          ))
        )}
      </div>
    </section>
  );
}

const ResultCard = memo(function ResultCard({ hit, icon, state, onInstall }: { hit: ModHit; icon: string; state?: InstallState; onInstall(id: string): void }) {
  const failed = typeof state === "object";
  return (
    <div className="cresult">
      <span className="citem-icon big">{hit.icon_url ? <img src={hit.icon_url} alt="" loading="lazy" /> : <Icon name={icon} />}</span>
      <div className="citem-text">
        <div className="citem-name">
          <b>{hit.title}</b>
          <span className="by">by {hit.author}</span>
        </div>
        <p className="cresult-desc">{hit.description}</p>
        <span className="citem-sub mono"><Icon name="download" />{compact(hit.downloads)}</span>
      </div>
      {state === "installed" ? (
        <button className="btn small installed" disabled>
          <Icon name="check" />
          Installed
        </button>
      ) : (
        <button
          className="btn small"
          disabled={state === "installing"}
          title={failed ? state.error : undefined}
          aria-label={`Install ${hit.title}`}
          onClick={() => onInstall(hit.project_id)}
        >
          <Icon name={state === "installing" ? "progress_activity" : failed ? "refresh" : "download"} spin={state === "installing"} />
          {state === "installing" ? "Installing" : failed ? "Retry" : "Install"}
        </button>
      )}
    </div>
  );
});
