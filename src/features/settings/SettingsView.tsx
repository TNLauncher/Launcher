import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "@/components/layout/View";
import { Button, ConfirmDialog, Icon, IconButton, Input, Select, Switch, Textarea } from "@/components/ui";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { launcher } from "@/api/launcher";
import { sources, type PluginEntry } from "@/api/sources";
import { usePlugins } from "@/hooks/useSource";
import { usePluginFailures } from "@/plugins/bridge";
import type { DeviceCode, Settings } from "@/types";
import s from "./settings.module.css";

// Keep in sync with Settings::default() in src-tauri/src/models/settings.rs.
const DEFAULT_JVM_ARGS =
  "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC";
const DEFAULTS: Omit<Settings, "username"> = {
  javaPath: "",
  ramMb: 4096,
  jvmArgs: DEFAULT_JVM_ARGS,
  width: 1280,
  height: 720,
  fullscreen: false,
  afterLaunch: "hide",
};
const USERNAME = /^[A-Za-z0-9_]{3,16}$/;
const SAVE_DELAY = 400;

export function SettingsView() {
  const { snapshot, saveSettings } = useLauncher();
  const [form, setForm] = useState<Settings | null>(snapshot?.settings ?? null);
  const [status, setStatus] = useState("Changes save automatically");
  const [confirmReset, setConfirmReset] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!form && snapshot) setForm(snapshot.settings);
  }, [snapshot, form]);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!form) return <View />;
  const usernameValid = USERNAME.test(form.username);

  function update(patch: Partial<Settings>) {
    const next = { ...form!, ...patch };
    setForm(next);
    setStatus("Saving…");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // An invalid name is kept in the field but never persisted.
      const toSave = USERNAME.test(next.username) ? next : { ...next, username: snapshot!.settings.username };
      saveSettings(toSave).then(
        () => setStatus("All changes saved"),
        (e) => setStatus(`Could not save: ${errorMessage(e)}`)
      );
    }, SAVE_DELAY);
  }

  const int = (v: string, fallback: number) => Math.max(1, parseInt(v, 10) || fallback);

  return (
    <View className={s.view}>
      <form className={s.settings} onSubmit={(e) => e.preventDefault()}>
        <h1>Settings</h1>

        <Group icon="memory" title="Java & memory">
          <Row label="RAM allocation" hint="Maximum heap for every instance. 4–6 GB suits most modpacks.">
            <div className={cx(s.settingControl, s.col)}>
              <div className={s.settingControl}>
                <input
                  className={s.range}
                  type="range" min={1} max={16} step={0.5} aria-label="RAM in gigabytes"
                  value={form.ramMb / 1024}
                  onChange={(e) => update({ ramMb: Math.round(parseFloat(e.target.value) * 1024) })}
                />
                <span className={cx(s.ramChip, "mono")}>{form.ramMb} MB</span>
              </div>
              <div className={cx(s.ticks, "mono")}>
                {[1, 4, 8, 12, 16].map((gb) => (
                  <span key={gb} style={{ left: `${((gb - 1) / 15) * 100}%` }}>{gb} GB</span>
                ))}
              </div>
            </div>
          </Row>
          <Row label="Java runtime" hint="Leave empty and the launcher downloads the right Java for each version.">
            <div className={s.settingControl}>
              <Input mono className={s.grow} placeholder="Managed automatically" spellCheck={false} aria-label="Java path"
                value={form.javaPath} onChange={(e) => update({ javaPath: e.target.value })} />
            </div>
          </Row>
          <Row label="JVM arguments" hint="Extra flags passed to Java for all instances." top>
            <div className={cx(s.settingControl, s.col)}>
              <Textarea rows={2} spellCheck={false} aria-label="JVM arguments"
                value={form.jvmArgs} onChange={(e) => update({ jvmArgs: e.target.value })} />
              <Button variant="link" className={s.alignEnd} onClick={() => update({ jvmArgs: DEFAULT_JVM_ARGS })}>Reset flags</Button>
            </div>
          </Row>
        </Group>

        <Group icon="desktop_windows" title="Game window">
          <Row label="Window size" hint="Size of the game window when it opens.">
            <div className={cx(s.settingControl, s.between)}>
              <div className={s.res}>
                <Input mono className={s.resInput} inputMode="numeric" aria-label="Width" value={form.width} onChange={(e) => update({ width: int(e.target.value, 1280) })} />
                <span className="subtle mono">×</span>
                <Input mono className={s.resInput} inputMode="numeric" aria-label="Height" value={form.height} onChange={(e) => update({ height: int(e.target.value, 720) })} />
                <span className="mono muted">px</span>
              </div>
              <label className={s.toggle}>
                Fullscreen
                <Switch label="Fullscreen" checked={form.fullscreen} onChange={(fullscreen) => update({ fullscreen })} />
              </label>
            </div>
          </Row>
        </Group>

        <Group icon="tune" title="Launcher">
          <Row label="After launch" hint="What the launcher does once the game starts.">
            <div className={cx(s.settingControl, s.end)}>
              <Select label="After launch" className={s.select} value={form.afterLaunch} onChange={(afterLaunch) => update({ afterLaunch })}
                options={[
                  { value: "hide", label: "Hide while playing" },
                  { value: "keep", label: "Keep open" },
                  { value: "close", label: "Close launcher" },
                ]} />
            </div>
          </Row>
        </Group>

        <Group icon="manage_accounts" title="Account" aside={snapshot?.account?.providerName ?? "Offline mode"}>
          <AccountRows />
          <Row label="Player name" hint="Used when playing offline: singleplayer and offline-mode servers.">
            <div className={cx(s.settingControl, s.col)}>
              <Input maxLength={16} spellCheck={false} aria-label="Player name" aria-invalid={!usernameValid}
                value={form.username} onChange={(e) => update({ username: e.target.value })} />
              {!usernameValid && <span className={s.error}>3–16 letters, digits or underscores.</span>}
            </div>
          </Row>
        </Group>

        <PluginsGroup />

        <div className={s.settingsFoot}>
          <div><Icon name="check_circle" /><span className="mono">{status}</span></div>
          <Button onClick={() => setConfirmReset(true)}>Restore defaults</Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmReset}
        title="Restore default settings?"
        confirmLabel="Restore"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          update({ ...DEFAULTS });
        }}
      >
        Memory, Java, window and launcher options go back to defaults. Your player name stays.
      </ConfirmDialog>
    </View>
  );
}

/** Signed-in accounts (pick the one launches use), Microsoft sign-in, and the forms of account provider plugins. */
function AccountRows() {
  const { snapshot, refresh } = useLauncher();
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: launcher.listAccounts });
  const providers = (usePlugins().data ?? []).filter((p) => p.enabled && p.account);
  const [error, setError] = useState("");
  const [ms, setMs] = useState<{ code?: DeviceCode } | null>(null);

  const done = () => Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["accounts"] })]).then(() => setError(""));
  const act = (p: Promise<unknown>) => p.then(done, (e) => setError(errorMessage(e)));

  async function signInMicrosoft() {
    setMs({});
    await act(launcher.microsoftLogin((code) => setMs({ code })));
    setMs(null);
  }

  const offline = !snapshot?.account;
  return (
    <>
      <Row label="Play as" hint="The account the game starts with. Offline uses the player name below.">
        <div className={cx(s.settingControl, s.col)}>
          <AccountLine name={`${snapshot?.settings.username || "Player"}`} provider="Offline" selected={offline} onSelect={() => act(launcher.selectAccount(null))} />
          {accounts.data?.map((a) => (
            <AccountLine
              key={a.id}
              name={a.name}
              provider={a.providerName}
              selected={a.selected}
              onSelect={() => act(launcher.selectAccount(a.id))}
              onRemove={() => act(launcher.removeAccount(a.id))}
            />
          ))}
          {error && <span className={s.error}>{error}</span>}
        </div>
      </Row>
      <Row label="Microsoft" hint="Sign in to play your licensed Minecraft: Java Edition on online servers.">
        <div className={cx(s.settingControl, s.col)}>
          {ms ? (
            <span role="status">
              {ms.code ? (
                <>Enter <strong className={cx("mono", s.code)}>{ms.code.userCode}</strong> at{" "}
                  <span className="mono">{ms.code.verificationUri}</span> (opened in your browser)</>
              ) : "Requesting code…"}
            </span>
          ) : (
            <Button className={s.alignEnd} onClick={signInMicrosoft}>Sign in with Microsoft</Button>
          )}
        </div>
      </Row>
      {providers.map((p) => (
        <PluginSignIn key={p.id} plugin={p} onSignedIn={done} />
      ))}
    </>
  );
}

function AccountLine(p: { name: string; provider: string; selected: boolean; onSelect(): void; onRemove?(): void }) {
  return (
    <div className={cx(s.settingControl, s.between)}>
      <span>
        <strong className="mono">{p.name}</strong> <span className="subtle">· {p.provider}</span>
      </span>
      <span className={s.settingControl}>
        {p.selected ? <Icon name="check_circle" fill /> : <Button size="sm" onClick={p.onSelect}>Use</Button>}
        {p.onRemove && <IconButton icon="delete" label={`Remove ${p.name}`} variant="danger" onClick={p.onRemove} />}
      </span>
    </div>
  );
}

/** The sign-in form an account provider plugin declares. */
function PluginSignIn({ plugin, onSignedIn }: { plugin: PluginEntry; onSignedIn(): Promise<unknown> }) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = () => {
    setBusy(true);
    launcher
      .pluginLogin(plugin.id, fields)
      .then(() => (setFields({}), setError(""), onSignedIn()), (e) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };
  return (
    <Row label={plugin.name} hint={plugin.permissions.jvm ? `${plugin.description} Loads a Java agent into the game.` : plugin.description}>
      <div className={cx(s.settingControl, s.col)}>
        {plugin.account!.fields.map((f) => (
          <Input
            key={f.key}
            type={f.type === "secret" ? "password" : "text"}
            spellCheck={false}
            placeholder={f.label}
            aria-label={`${plugin.name} ${f.label}`}
            title={f.hint || undefined}
            value={fields[f.key] ?? ""}
            onChange={(e) => setFields((v) => ({ ...v, [f.key]: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        ))}
        <Button className={s.alignEnd} loading={busy} onClick={submit}>Sign in with {plugin.name}</Button>
        {error && <span className={s.error}>{error}</span>}
      </div>
    </Row>
  );
}

/** Bundled and user plugins; a turned-off content source disappears from the catalogs, installed files stay. */
function PluginsGroup() {
  const qc = useQueryClient();
  const plugins = usePlugins();
  const failures = usePluginFailures();
  const [error, setError] = useState("");
  const toggle = (id: string, enabled: boolean) =>
    sources
      .setPluginEnabled(id, enabled)
      .then(() => setError(""), (e) => setError(errorMessage(e)))
      .finally(() => qc.invalidateQueries());
  return (
    <Group icon="extension" title="Plugins" aside="New plugins load on restart">
      {plugins.data?.map((p) =>
        p.error ? (
          <Row key={`failed-${p.name}`} label={p.name} hint="Could not load this plugin.">
            <span className={s.error}>{p.error}</span>
          </Row>
        ) : (
          <Row
            key={p.id}
            label={`${p.name} ${p.version}${p.bundled ? "" : " · added by you"}`}
            hint={[
              p.description,
              p.permissions.hosts.length ? `Connects to ${p.permissions.hosts.join(", ")}.` : "No network access.",
              p.permissions.instances && "Reads your instances and when you play.",
              p.permissions.presence && "Sets your Discord status.",
              p.permissions.jvm && "Loads a Java agent into the game.",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className={cx(s.settingControl, s.col)}>
              <Switch label={`${p.enabled ? "Turn off" : "Turn on"} ${p.name}`} checked={p.enabled} onChange={(on) => toggle(p.id, on)} />
              {p.enabled && failures[p.id] && <span className={s.error}>Failed to start: {failures[p.id]}</span>}
            </div>
          </Row>
        )
      )}
      {plugins.data?.map((p) =>
        p.error || !p.settings.length ? null : (
          <PluginSettings key={`settings-${p.id}`} plugin={p} onError={setError} />
        )
      )}
      <Row label="Plugin folder" hint="Put a plugin's folder (manifest.json + its scripts) here and restart the launcher.">
        <div className={s.settingControl}>
          <Button icon="folder_open" onClick={() => sources.openPluginsDir().catch((e) => setError(errorMessage(e)))}>Open folder</Button>
        </div>
      </Row>
      {(error || plugins.error) && <span className={s.error}>{error || errorMessage(plugins.error)}</span>}
    </Group>
  );
}

/** Fields a plugin declares (`contributes.settings`); text saves on blur, toggles at once. */
function PluginSettings({ plugin, onError }: { plugin: PluginEntry; onError(message: string): void }) {
  const values = useQuery({ queryKey: ["plugin-settings", plugin.id], queryFn: () => sources.settings(plugin.id) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = (key: string, value: string | boolean) =>
    sources.setSetting(plugin.id, key, value).then(() => values.refetch(), (e) => onError(errorMessage(e)));
  if (!values.data) return null;
  return (
    <>
      {plugin.settings.map((f) => (
        <Row key={f.key} label={`${plugin.name}: ${f.label}`} hint={f.hint}>
          <div className={s.settingControl}>
            {f.type === "toggle" ? (
              <Switch label={f.label} checked={values.data[f.key] === true} onChange={(on) => save(f.key, on)} />
            ) : (
              <Input
                type={f.type === "secret" ? "password" : "text"}
                spellCheck={false}
                aria-label={f.label}
                value={draft[f.key] ?? String(values.data[f.key] ?? "")}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                onBlur={() => draft[f.key] !== undefined && save(f.key, draft[f.key])}
              />
            )}
          </div>
        </Row>
      ))}
    </>
  );
}

function Group({ icon, title, aside, children }: { icon: string; title: string; aside?: string; children: ReactNode }) {
  return (
    <section>
      <div className={s.groupHead}>
        <div><Icon name={icon} /><h2>{title}</h2></div>
        {aside && <span className="mono subtle">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, hint, top, children }: { label: string; hint: string; top?: boolean; children: ReactNode }) {
  return (
    <div className={cx(s.setting, top && s.top)}>
      <div className={s.settingLabel}><strong>{label}</strong><span>{hint}</span></div>
      {children}
    </div>
  );
}
