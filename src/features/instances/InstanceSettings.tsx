import { useEffect, useRef, useState } from "react";
import { launcher } from "@/api/launcher";
import { Button, Input, Switch, Textarea } from "@/components/ui";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { DEFAULT_JVM_ARGS, Group, RamSlider, Row } from "@/features/settings/SettingsView";
import type { Instance, InstanceSettings, Settings } from "@/types";
import s from "@/features/settings/settings.module.css";

const SAVE_DELAY = 400;

type Key = keyof Settings & keyof InstanceSettings;
/** Fields one "Custom" switch covers. */
const SECTIONS = {
  java: ["javaPath"],
  memory: ["ramMb"],
  jvm: ["jvmArgs"],
  window: ["width", "height", "fullscreen"],
} satisfies Record<string, Key[]>;

/** Per-instance overrides of the global settings, Prism style: every section is global until switched to custom. */
export function InstanceSettingsPane({ instance }: { instance: Instance }) {
  const { snapshot, refresh } = useLauncher();
  const [form, setForm] = useState(instance.settings);
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!snapshot) return null;
  const global = snapshot.settings;

  function update(patch: Partial<InstanceSettings>) {
    const next = { ...form, ...patch };
    setForm(next);
    setStatus("Saving…");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      launcher.setInstanceSettings(instance.id, next).then(
        () => (setStatus("Saved"), refresh()),
        (e) => setStatus(`Could not save: ${errorMessage(e)}`)
      );
    }, SAVE_DELAY);
  }

  // Shown value: the override, else the global one. Editing a field makes it custom.
  const value = <K extends Key>(k: K) => (form[k] ?? global[k]) as Settings[K];
  const custom = (keys: Key[]) => keys.some((k) => form[k] !== null);
  const setCustom = (keys: Key[], on: boolean) => update(Object.fromEntries(keys.map((k) => [k, on ? global[k] : null])));
  const toggle = (keys: Key[]) => (
    <label className={s.toggle}>
      Custom
      <Switch label="Override global settings" checked={custom(keys)} onChange={(on) => setCustom(keys, on)} />
    </label>
  );
  const int = (v: string, fallback: number) => Math.max(1, parseInt(v, 10) || fallback);

  return (
    <form className={s.instancePane} onSubmit={(e) => e.preventDefault()}>
      <Group icon="coffee" title="Java" aside={toggle(SECTIONS.java)}>
        <Row label="Java runtime" hint="Path to the java binary for this instance. Empty = downloaded automatically.">
          <div className={s.settingControl}>
            <Input mono className={s.grow} placeholder="Managed automatically" spellCheck={false} aria-label="Java path"
              value={value("javaPath")} onChange={(e) => update({ javaPath: e.target.value })} />
          </div>
        </Row>
      </Group>

      <Group icon="memory" title="Memory" aside={toggle(SECTIONS.memory)}>
        <Row label="RAM allocation" hint="Maximum heap for this instance.">
          <RamSlider value={value("ramMb")} onChange={(ramMb) => update({ ramMb })} />
        </Row>
      </Group>

      <Group icon="terminal" title="JVM arguments" aside={toggle(SECTIONS.jvm)}>
        <Row label="JVM arguments" hint="Flags passed to Java for this instance." top>
          <div className={cx(s.settingControl, s.col)}>
            <Textarea rows={2} spellCheck={false} aria-label="JVM arguments"
              value={value("jvmArgs")} onChange={(e) => update({ jvmArgs: e.target.value })} />
            <Button variant="link" className={s.alignEnd} onClick={() => update({ jvmArgs: DEFAULT_JVM_ARGS })}>Reset flags</Button>
          </div>
        </Row>
      </Group>

      <Group icon="desktop_windows" title="Game window" aside={toggle(SECTIONS.window)}>
        <Row label="Window size" hint="Size of the game window when it opens.">
          <div className={cx(s.settingControl, s.between)}>
            <div className={s.res}>
              <Input mono className={s.resInput} inputMode="numeric" aria-label="Width" value={value("width")} onChange={(e) => update({ width: int(e.target.value, global.width) })} />
              <span className="subtle mono">×</span>
              <Input mono className={s.resInput} inputMode="numeric" aria-label="Height" value={value("height")} onChange={(e) => update({ height: int(e.target.value, global.height) })} />
              <span className="mono muted">px</span>
            </div>
            <label className={s.toggle}>
              Fullscreen
              <Switch label="Fullscreen" checked={value("fullscreen")} onChange={(fullscreen) => update({ fullscreen })} />
            </label>
          </div>
        </Row>
      </Group>

      <Group icon="rocket_launch" title="Launch" aside={status}>
        <Row label="Wrapper command" hint="The game runs through it, e.g. gamemoderun or mangohud.">
          <div className={s.settingControl}>
            <Input mono className={s.grow} placeholder="None" spellCheck={false} aria-label="Wrapper command"
              value={form.wrapper} onChange={(e) => update({ wrapper: e.target.value })} />
          </div>
        </Row>
        <Row label="Environment variables" hint="One KEY=VALUE per line." top>
          <div className={s.settingControl}>
            <Textarea className={cx(s.grow, "mono")} rows={3} spellCheck={false} aria-label="Environment variables" placeholder="__GL_THREADED_OPTIMIZATIONS=1"
              value={form.env} onChange={(e) => update({ env: e.target.value })} />
          </div>
        </Row>
      </Group>
    </form>
  );
}
