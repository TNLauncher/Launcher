import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { sources, type PluginEntry, type StoreEntry } from "@/api/sources";
import { View } from "@/components/layout/View";
import { Banner, Button, ConfirmDialog, EmptyState, Icon, IconButton, Input, Select, Switch, Tab, Tabs } from "@/components/ui";
import { usePlugins } from "@/hooks/useSource";
import { isNewer, usePluginStore, usePluginUpdateCount } from "@/hooks/useUpdates";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/format";
import { bumpPluginRevision, emitToPlugin, usePluginFailures } from "@/plugins/bridge";
import s from "./plugins.module.css";

/** Bundled and user plugins, and the store to get more; a turned-off content source disappears from the catalogs, installed files stay. */
export function PluginsView() {
  const qc = useQueryClient();
  const plugins = usePlugins();
  const failures = usePluginFailures();
  const [error, setError] = useState("");
  const [reloading, setReloading] = useState(false);
  const [removing, setRemoving] = useState<PluginEntry | null>(null);
  const updates = usePluginUpdateCount();
  const store = usePluginStore();
  // Arriving with updates waiting (the sidebar dot) opens where the Update buttons are.
  const [tab, setTab] = useState<"installed" | "store">(() => (updates > 0 ? "store" : "installed"));

  const replaceList = (list: PluginEntry[]) => {
    qc.setQueryData(["plugins"], list);
    bumpPluginRevision();
    setError("");
  };

  const toggle = (id: string, enabled: boolean) =>
    sources
      .setPluginEnabled(id, enabled)
      .then(() => setError(""), (e) => setError(errorMessage(e)))
      .finally(() => qc.invalidateQueries());

  const reload = () => {
    setReloading(true);
    sources
      .reloadPlugins()
      .then(replaceList, (e) => setError(errorMessage(e)))
      .finally(() => {
        setReloading(false);
        void qc.invalidateQueries();
      });
  };

  const remove = (p: PluginEntry) =>
    sources
      .removePlugin(p.id)
      .then(replaceList, (e) => setError(errorMessage(e)))
      .finally(() => qc.invalidateQueries());

  const list = plugins.data ?? [];
  const on = list.filter((p) => !p.error && p.enabled).length;
  const broken = list.filter((p) => p.error).length;

  return (
    <View className={s.page}>
      <header className={s.head}>
        <div>
          <h1>Plugins</h1>
          {list.length > 0 && (
            <span className={cx(s.count, "mono")}>
              {on} on · {list.length - on - broken} off{broken > 0 && <span className={s.bad}> · {broken} failed</span>}
            </span>
          )}
        </div>
        <div className={s.actions}>
          <Button icon="folder_open" onClick={() => sources.openPluginsDir().catch((e) => setError(errorMessage(e)))}>Open folder</Button>
          <Button icon="refresh" loading={reloading} onClick={reload}>Reload</Button>
        </div>
      </header>

      {(error || plugins.error) && <Banner message={error || errorMessage(plugins.error)} onDismiss={() => setError("")} />}

      <Tabs label="Plugins">
        <Tab selected={tab === "installed"} onSelect={() => setTab("installed")} icon="extension" count={list.length || null}>Installed</Tab>
        <Tab selected={tab === "store"} onSelect={() => setTab("store")} icon="storefront" count={updates || null}>Store</Tab>
      </Tabs>

      {tab === "store" ? (
        <div role="tabpanel"><PluginStore installed={list} onInstalled={replaceList} onError={setError} /></div>
      ) : plugins.isSuccess && !list.length ? (
        <EmptyState icon="extension_off" action={<Button icon="folder_open" onClick={() => sources.openPluginsDir()}>Open plugin folder</Button>}>
          No plugins yet. Get one from the Store, or put a plugin's folder in the plugin folder and press Reload.
        </EmptyState>
      ) : (
        <ul className={s.list}>
          {list.map((p) =>
            p.error ? (
              <li key={`failed-${p.name}`} className={cx(s.plugin, s.failed)}>
                <span className={s.tile}><Icon name="error" /></span>
                <div className={s.body}>
                  <div className={s.title}><strong>{p.name}</strong><span className={s.tag}>Did not load</span></div>
                  <p className={cx(s.reason, "mono")}>{p.error}</p>
                </div>
              </li>
            ) : (
              <PluginRow key={p.id} plugin={p} failure={failures[p.id]}
                update={store.data?.find((e) => e.manifest.id === p.id && !p.bundled && isNewer(e.manifest.version, p.version))?.manifest.version}
                onUpdate={() => setTab("store")} onToggle={(v) => toggle(p.id, v)} onRemove={() => setRemoving(p)} onError={setError} />
            )
          )}
        </ul>
      )}

      <p className={s.foot}>
        <Icon name="info" />
        <span>A plugin is a folder with a <code className="mono">manifest.json</code> and its scripts. Changes on disk apply after Reload.</span>
      </p>

      <ConfirmDialog
        open={!!removing}
        title={`Delete ${removing?.name}?`}
        confirmLabel="Delete"
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing!;
          setRemoving(null);
          void remove(target);
        }}
      >
        Removes the plugin folder and its stored plugin data from disk.
      </ConfirmDialog>
    </View>
  );
}

/** What a plugin may touch, in plain words. */
function permissions(perms: PluginEntry["permissions"]): { icon: string; text: string; title?: string }[] {
  const { hosts, instances, presence, jvm, programs } = perms;
  return [
    hosts.length
      ? { icon: "public", text: hosts.length === 1 ? hosts[0] : `${hosts.length} sites`, title: `Connects to ${hosts.join(", ")}` }
      : { icon: "cloud_off", text: "No network" },
    instances ? { icon: "layers", text: "Reads instances & playtime" } : null,
    presence ? { icon: "forum", text: "Discord status" } : null,
    jvm ? { icon: "memory", text: "Java agent in game" } : null,
    programs ? { icon: "terminal", text: "Runs programs it downloads" } : null,
  ].filter((x) => x !== null);
}

function PluginRow({ plugin: p, failure, update, onUpdate, onToggle, onRemove, onError }: {
  plugin: PluginEntry;
  failure?: string;
  /** A newer store version, if any. */
  update?: string;
  onUpdate(): void;
  onToggle(on: boolean): void;
  onRemove(): void;
  onError(message: string): void;
}) {
  const icon = p.pages[0]?.icon ?? p.instanceTabs[0]?.icon ?? "extension";
  return (
    <li className={cx(s.plugin, !p.enabled && s.off)}>
      <span className={s.tile}><Icon name={icon} fill={p.enabled} /></span>
      <div className={s.body}>
        <div className={s.title}>
          <strong>{p.name}</strong>
          <span className="mono subtle">{p.version}</span>
          {!p.bundled && <span className={s.tag}>Added by you</span>}
        </div>
        {p.description && <p className={s.desc}>{p.description}</p>}
        <ul className={s.perms} aria-label="Permissions">
          {permissions(p.permissions).map((x) => (
            <li key={x.icon} title={x.title}><Icon name={x.icon} />{x.text}</li>
          ))}
        </ul>
        {p.enabled && failure && <p className={s.reason}><Icon name="error" />Failed to start: {failure}</p>}
        {p.enabled && p.settings.length > 0 && <PluginSettings plugin={p} onError={onError} />}
      </div>
      <div className={s.controls}>
        {update && <Button icon="upgrade" onClick={onUpdate}>Update to {update}</Button>}
        {!p.bundled && <IconButton icon="delete" label={`Delete ${p.name}`} variant="danger" onClick={onRemove} />}
        <Switch label={`${p.enabled ? "Turn off" : "Turn on"} ${p.name}`} checked={p.enabled} onChange={onToggle} />
      </div>
    </li>
  );
}

/** The plugin store's catalog; installing asks first, with what the plugin may touch. */
function PluginStore({ installed, onInstalled, onError }: {
  installed: PluginEntry[];
  onInstalled(list: PluginEntry[]): void;
  onError(message: string): void;
}) {
  const store = usePluginStore();
  const [asking, setAsking] = useState<StoreEntry | null>(null);
  const [busy, setBusy] = useState("");

  const install = (e: StoreEntry) => {
    setBusy(e.manifest.id);
    sources
      .installPlugin(e.manifest.id)
      .then(onInstalled, (err) => onError(errorMessage(err)))
      .finally(() => setBusy(""));
  };

  if (store.isPending) return null;
  if (store.isError)
    return (
      <EmptyState icon="cloud_off" action={<Button icon="refresh" loading={store.isFetching} onClick={() => store.refetch()}>Retry</Button>}>
        Couldn't load the plugin store: {errorMessage(store.error)}
      </EmptyState>
    );
  if (!store.data.length) return <EmptyState icon="storefront">The store has no plugins for this launcher version yet.</EmptyState>;

  return (
    <>
      <ul className={s.list}>
        {store.data.map((e) => {
          const m = e.manifest;
          const have = installed.find((p) => p.id === m.id);
          const icon = m.contributes.pages[0]?.icon ?? m.contributes.instanceTabs[0]?.icon ?? m.contributes.runtime?.icon ?? "extension";
          return (
            <li key={m.id} className={s.plugin}>
              <span className={s.tile}><Icon name={icon} /></span>
              <div className={s.body}>
                <div className={s.title}>
                  <strong>{m.name}</strong>
                  <span className="mono subtle">{m.version}</span>
                  {have && have.version !== m.version && <span className={s.tag}>{have.version} installed</span>}
                </div>
                {m.description && <p className={s.desc}>{m.description}</p>}
                <ul className={s.perms} aria-label="Permissions">
                  {permissions(m.permissions).map((x) => (
                    <li key={x.icon} title={x.title}><Icon name={x.icon} />{x.text}</li>
                  ))}
                </ul>
              </div>
              <div className={s.controls}>
                {have?.bundled ? (
                  <span className={s.tag}>Built-in</span>
                ) : have && !isNewer(m.version, have.version) ? (
                  <Button icon="check" disabled>Installed</Button>
                ) : (
                  <Button variant="primary" icon={have ? "upgrade" : "download"} loading={busy === m.id} disabled={!!busy} onClick={() => setAsking(e)}>
                    {have ? "Update" : "Install"}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={!!asking}
        title={`Install ${asking?.manifest.name}?`}
        confirmLabel="Install"
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          const target = asking!;
          setAsking(null);
          install(target);
        }}
      >
        {asking && `${permissions(asking.manifest.permissions).map((x) => x.title ?? x.text).join(" · ")}. Downloaded from ${new URL(asking.url).host}.`}
      </ConfirmDialog>
    </>
  );
}

/** Fields a plugin declares (`contributes.settings`); text saves on blur, toggles and selects at once. */
function PluginSettings({ plugin, onError }: { plugin: PluginEntry; onError(message: string): void }) {
  const values = useQuery({ queryKey: ["plugin-settings", plugin.id], queryFn: () => sources.settings(plugin.id) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = (key: string, value: string | boolean) =>
    sources.setSetting(plugin.id, key, value).then(
      () => {
        emitToPlugin(plugin.id, "settings-changed", { key, value });
        return values.refetch();
      },
      (e) => onError(errorMessage(e))
    );
  if (!values.data) return null;
  return (
    <div className={s.settings}>
      {plugin.settings.map((f) => (
        <div key={f.key} className={s.field}>
          <div className={s.fieldLabel}>
            <strong>{f.label}</strong>
            {f.hint && <span>{f.hint}</span>}
          </div>
          {f.type === "toggle" ? (
            <Switch label={f.label} checked={values.data[f.key] === true} onChange={(on) => save(f.key, on)} />
          ) : f.type === "select" ? (
            <Select
              label={f.label}
              className={s.input}
              value={String(values.data[f.key] ?? f.options?.[0]?.id ?? "")}
              onChange={(v) => save(f.key, v)}
              options={(f.options ?? []).map((o) => ({ value: o.id, label: o.label }))}
            />
          ) : (
            <Input
              className={s.input}
              type={f.type === "secret" ? "password" : "text"}
              spellCheck={false}
              aria-label={f.label}
              value={draft[f.key] ?? String(values.data[f.key] ?? "")}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              onBlur={() => draft[f.key] !== undefined && save(f.key, draft[f.key])}
            />
          )}
        </div>
      ))}
    </div>
  );
}
