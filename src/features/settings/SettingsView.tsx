import { useEffect, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { View } from "@/components/layout/View";
import { Button, ConfirmDialog, Icon, Input, Select, Switch, Textarea } from "@/components/ui";
import { useChanged } from "@/hooks/useChanged";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
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

        <UpdatesGroup />

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

function UpdatesGroup() {
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState("Checking for updates…");
  const [busy, setBusy] = useState(true);

  async function find() {
    setBusy(true);
    setStatus("Checking for updates…");
    try {
      const found = await check();
      setUpdate(found);
      setStatus(found ? `Version ${found.version} is available.` : "You're on the latest version.");
    } catch (e) {
      setStatus(`Could not check for updates: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    if (!update) return;
    setBusy(true);
    let total = 0;
    let done = 0;
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          setStatus(total ? `Downloading… ${Math.round((done / total) * 100)}%` : "Downloading…");
        } else setStatus("Installing…");
      });
      await relaunch();
    } catch (e) {
      setStatus(`Could not install the update: ${errorMessage(e)}`);
      setBusy(false);
    }
  }

  useEffect(() => {
    getVersion().then(setVersion);
    find();
  }, []);

  return (
    <Group icon="system_update" title="Updates" aside={version && `v${version}`}>
      <Row label="Launcher version" hint={status}>
        <div className={cx(s.settingControl, s.end)}>
          {update
            ? <Button variant="primary" icon="download" loading={busy} onClick={install}>Install {update.version} and restart</Button>
            : <Button icon="refresh" loading={busy} onClick={find}>Check for updates</Button>}
        </div>
      </Row>
    </Group>
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
