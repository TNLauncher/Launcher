import { useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "@/components/layout/View";
import { Button, ConfirmDialog, Icon, Input, Select, Switch, Textarea } from "@/components/ui";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { launcher } from "@/api/launcher";
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
  const { snapshot, saveSettings, refresh } = useLauncher();
  const [form, setForm] = useState<Settings | null>(snapshot?.settings ?? null);
  const [status, setStatus] = useState("Changes save automatically");
  const [confirmReset, setConfirmReset] = useState(false);
  const [login, setLogin] = useState<{ code?: DeviceCode; error?: string } | null>(null);
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

  async function signIn() {
    setLogin({});
    try {
      await launcher.microsoftLogin((code) => setLogin({ code }));
      setLogin(null);
      await refresh();
    } catch (e) {
      setLogin({ error: errorMessage(e) });
    }
  }

  async function signOut() {
    await launcher.microsoftLogout();
    await refresh();
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

        <Group icon="manage_accounts" title="Account" aside={snapshot?.account ? "Licensed" : "Offline mode"}>
          <Row label="Microsoft account" hint="Sign in to play with your licensed Minecraft: Java Edition on online servers.">
            <div className={cx(s.settingControl, s.col)}>
              {snapshot?.account ? (
                <div className={cx(s.settingControl, s.between)}>
                  <strong className="mono">{snapshot.account}</strong>
                  <Button onClick={signOut}>Sign out</Button>
                </div>
              ) : login && !login.error ? (
                <span role="status">
                  {login.code ? (
                    <>Enter <strong className={cx("mono", s.code)}>{login.code.userCode}</strong> at{" "}
                      <span className="mono">{login.code.verificationUri}</span> (opened in your browser)</>
                  ) : "Requesting code…"}
                </span>
              ) : (
                <>
                  <Button className={s.alignEnd} onClick={signIn}>Sign in with Microsoft</Button>
                  {login?.error && <span className={s.error}>{login.error}</span>}
                </>
              )}
            </div>
          </Row>
          <Row label="Player name" hint="Used when not signed in: singleplayer and offline-mode servers.">
            <div className={cx(s.settingControl, s.col)}>
              <Input maxLength={16} spellCheck={false} aria-label="Player name" aria-invalid={!usernameValid}
                value={form.username} onChange={(e) => update({ username: e.target.value })} />
              {!usernameValid && <span className={s.error}>3–16 letters, digits or underscores.</span>}
            </div>
          </Row>
        </Group>

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
