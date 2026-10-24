import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "@/components/layout/View";
import { Button, ConfirmDialog, Icon, Input, Select, Switch, Textarea } from "@/components/ui";
import { useChanged } from "@/hooks/useChanged";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { sources, type PluginEntry } from "@/api/sources";
import { usePlugins } from "@/hooks/useSource";
import { usePluginFailures } from "@/plugins/bridge";
import type { Settings } from "@/types";
import s from "./settings.module.css";

// Keep in sync with Settings::default() in src-tauri/src/models/settings.rs.
export const DEFAULT_JVM_ARGS =
  "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC";
const DEFAULTS: Settings = {
  javaPath: "",
  ramMb: 4096,
  jvmArgs: DEFAULT_JVM_ARGS,
  width: 1280,
  height: 720,
  fullscreen: false,
  afterLaunch: "hide",
};
const SAVE_DELAY = 400;

export function SettingsView() {
  const settings = useLauncher((st) => st.snapshot?.settings ?? null);
  const saveSettings = useLauncher((st) => st.saveSettings);
  const [form, setForm] = useState<Settings | null>(settings);
  const [status, setStatus] = useState("Changes save automatically");
  const statusChanged = useChanged(status);
  const [confirmReset, setConfirmReset] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!form && settings) setForm(settings);
  }, [settings, form]);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!form) return <View />;
  const saving = status === "Saving…";
  const failed = status.startsWith("Could not");

  function update(patch: Partial<Settings>) {
    const next = { ...form!, ...patch };
    setForm(next);
    setStatus("Saving…");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveSettings(next).then(
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
            <RamSlider value={form.ramMb} onChange={(ramMb) => update({ ramMb })} />
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

        <PluginsGroup />

        <div className={s.settingsFoot}>
          {/* Keyed so each new save state lands with its own beat. */}
          <div key={status} className={cx(s.saveState, statusChanged && s.saveChanged, saving && s.saving, failed && s.saveFailed)} role="status">
            <Icon name={saving ? "progress_activity" : failed ? "error" : "check_circle"} spin={saving} fill={!saving} />
            <span className="mono">{status}</span>
          </div>
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
        Memory, Java, window and launcher options go back to defaults.
      </ConfirmDialog>
    </View>
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

export function RamSlider({ value, onChange }: { value: number; onChange(mb: number): void }) {
  return (
    <div className={cx(s.settingControl, s.col)}>
      <div className={s.settingControl}>
        <input
          className={s.range}
          type="range" min={1} max={16} step={0.5} aria-label="RAM in gigabytes"
          value={value / 1024}
          onChange={(e) => onChange(Math.round(parseFloat(e.target.value) * 1024))}
        />
        <span className={cx(s.ramChip, "mono")}>{value} MB</span>
      </div>
      <div className={cx(s.ticks, "mono")}>
        {[1, 4, 8, 12, 16].map((gb) => (
          <span key={gb} style={{ left: `${((gb - 1) / 15) * 100}%` }}>{gb} GB</span>
        ))}
      </div>
    </div>
  );
}

export function Group({ icon, title, aside, children }: { icon: string; title: string; aside?: ReactNode; children: ReactNode }) {
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

export function Row({ label, hint, top, children }: { label: string; hint: string; top?: boolean; children: ReactNode }) {
  return (
    <div className={cx(s.setting, top && s.top)}>
      <div className={s.settingLabel}><strong>{label}</strong><span>{hint}</span></div>
      {children}
    </div>
  );
}
