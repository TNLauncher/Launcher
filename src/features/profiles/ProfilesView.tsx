import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";
import { View } from "@/components/layout/View";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, ConfirmDialog, Dot, Icon, IconButton, Input, Pill, PillGroup, Skeleton } from "@/components/ui";
import { launcher } from "@/api/launcher";
import { type PluginEntry } from "@/api/sources";
import { usePlugins } from "@/hooks/useSource";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import type { Account, DeviceCode } from "@/types";
import { SkinHead, SkinModel, useSkin } from "./Skin";
import s from "./profiles.module.css";

const USERNAME = /^[A-Za-z0-9_]{3,16}$/;
const SAVE_DELAY = 400;

/** Player accounts: the one launches use on a turntable, every signed-in one to switch to, and sign-in. */
export function ProfilesView() {
  const { snapshot, refresh } = useLauncher();
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: launcher.listAccounts });
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<Account | null>(null);

  // A new sign-in may bring a new skin for the same player.
  const done = () =>
    Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["accounts"] }), qc.invalidateQueries({ queryKey: ["skin"] })]).then(() => setError(""));
  const act = (p: Promise<unknown>) => p.then(done, (e) => setError(errorMessage(e)));

  if (!snapshot) return <View />;
  const active = snapshot.account;
  const offlineName = snapshot.settings.username || "Player";

  return (
    <View className={s.view}>
      <Stage account={active} offlineName={offlineName} />

      <div className={s.side}>
        <h1>Profiles</h1>

        <ul className={s.list} aria-label="Profiles">
          {accounts.isPending ? (
            [0, 1].map((i) => <li key={i}><Skeleton height={56} /></li>)
          ) : (
            <>
              {accounts.data?.map((a) => (
                <ProfileRow key={a.id} account={a} name={a.name} provider={a.providerName} selected={a.selected} onUse={() => act(launcher.selectAccount(a.id))} onRemove={() => setRemoving(a)} />
              ))}
              <ProfileRow name={offlineName} provider="Offline" selected={!active} onUse={() => act(launcher.selectAccount(null))} />
            </>
          )}
        </ul>
        {(error || accounts.error) && <p className={s.error} role="alert">{error || errorMessage(accounts.error)}</p>}

        <AddProfile onSignedIn={done} />
      </div>

      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing?.name}?`}
        confirmLabel="Remove"
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          act(launcher.removeAccount(removing!.id));
          setRemoving(null);
        }}
      >
        The launcher forgets this {removing?.providerName} sign-in. Your worlds and instances stay; sign in again to play with it.
      </ConfirmDialog>
    </View>
  );
}

/** Copies text; `copied` flips back after a moment. */
function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return [copied, (text) => void navigator.clipboard.writeText(text).then(() => setCopied(true), () => {})];
}

/** Skin pixel size: whole screen pixels per texel keep the edges crisp; the model takes about half the stage. */
function useModelScale(stage: RefObject<HTMLElement | null>) {
  const [px, setPx] = useState(9);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setPx(Math.max(8, Math.min(13, Math.floor(e.contentRect.height / 64)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [stage]);
  return px;
}

/** The active profile on a turntable. */
function Stage({ account, offlineName }: { account: Account | null; offlineName: string }) {
  const skin = useSkin(account);
  const name = account?.name ?? offlineName;
  const stage = useRef<HTMLElement>(null);
  const px = useModelScale(stage);
  const [turned, setTurned] = useState(false);
  return (
    <section ref={stage} className={s.stage} aria-label="Active profile">
      <div className={s.turntable}>
        <SkinModel skin={skin} px={px} label={`${name}'s skin`} onTurn={() => setTurned(true)} />
        <div className={s.floor} />
      </div>
      <span className={s.hint} data-gone={turned || undefined} aria-hidden>Drag to turn · double-click to reset</span>

      <div className={s.identity}>
        <h2 className={cx(s.name, "selectable")}>{name}</h2>
        <div className={s.status}>
          <Dot tone={account ? "green" : "neutral"} />
          {account ? `Signed in with ${account.providerName} · used for every launch` : "Offline · used for every launch, offline-mode servers only"}
        </div>
        {account ? <Uuid uuid={account.uuid} /> : <OfflineName />}
      </div>
    </section>
  );
}

function Uuid({ uuid }: { uuid: string }) {
  const [copied, copy] = useCopy();
  const dashed = uuid.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  return (
    <div className={s.uuid}>
      <span className={cx("mono", "selectable")}>{dashed}</span>
      <IconButton
        icon={copied ? "check" : "content_copy"}
        label={copied ? "Copied" : "Copy UUID"}
        onClick={() => copy(dashed)}
      />
    </div>
  );
}

/** The name offline play uses; an invalid one is kept in the field but never saved. */
function OfflineName() {
  const { snapshot, saveSettings } = useLauncher();
  const [value, setValue] = useState(snapshot!.settings.username);
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const valid = USERNAME.test(value);

  function change(next: string) {
    setValue(next);
    clearTimeout(timer.current);
    if (!USERNAME.test(next)) return setStatus("");
    setStatus("Saving…");
    timer.current = setTimeout(() => {
      saveSettings({ ...snapshot!.settings, username: next }).then(
        () => setStatus("Saved"),
        (e) => setStatus(`Could not save: ${errorMessage(e)}`)
      );
    }, SAVE_DELAY);
  }

  return (
    <label className={s.offline}>
      <span className={s.offlineLabel}>
        Player name <span className="subtle">for singleplayer and offline-mode servers</span>
      </span>
      <Input maxLength={16} spellCheck={false} aria-invalid={!valid} aria-describedby="offline-name-status" value={value} onChange={(e) => change(e.target.value)} />
      <span id="offline-name-status" className={cx(s.offlineStatus, !valid && s.error)} aria-live="polite">
        {valid ? status : "3–16 letters, digits or underscores."}
      </span>
    </label>
  );
}

/** No `account` = the offline profile. */
function ProfileRow(p: { account?: Account; name: string; provider: string; selected: boolean; onUse(): void; onRemove?(): void }) {
  const skin = useSkin(p.account);
  const { name, provider, selected } = p;
  return (
    <li className={s.row}>
      <button type="button" className={s.pick} aria-pressed={selected} onClick={selected ? undefined : p.onUse}>
        <SkinHead skin={skin} name={name} size={36} />
        <span className={s.rowText}>
          <span className={s.rowName}>{name}</span>
          <span className={s.rowSub}>{provider}</span>
        </span>
        {selected ? (
          <span className={s.current}><Icon name="check_circle" fill />Active</span>
        ) : (
          <span className={s.use}>Use</span>
        )}
      </button>
      {p.onRemove && <IconButton className={s.remove} icon="delete" label={`Remove ${name}`} variant="danger" onClick={p.onRemove} />}
    </li>
  );
}

/** Microsoft sign-in and the forms of account provider plugins, one at a time. */
function AddProfile({ onSignedIn }: { onSignedIn(): Promise<unknown> }) {
  const providers = (usePlugins().data ?? []).filter((p) => p.enabled && p.account);
  const [tab, setTab] = useState("microsoft");
  const plugin = providers.find((p) => p.id === tab);
  return (
    <section className={s.add} aria-labelledby="add-profile">
      <div className={s.addHead}>
        <h2 id="add-profile">Add a profile</h2>
        <PillGroup label="Sign in with">
          <Pill pressed={!plugin} onClick={() => setTab("microsoft")}>Microsoft</Pill>
          {providers.map((p) => (
            <Pill key={p.id} pressed={plugin?.id === p.id} onClick={() => setTab(p.id)}>{p.name}</Pill>
          ))}
        </PillGroup>
      </div>
      {plugin ? <PluginSignIn key={plugin.id} plugin={plugin} onSignedIn={onSignedIn} /> : <MicrosoftSignIn onSignedIn={onSignedIn} />}
    </section>
  );
}

function MicrosoftSignIn({ onSignedIn }: { onSignedIn(): Promise<unknown> }) {
  const [ms, setMs] = useState<{ code?: DeviceCode } | null>(null);
  const [error, setError] = useState("");
  const [copied, copy] = useCopy();

  async function signIn() {
    setMs({});
    setError("");
    await launcher.microsoftLogin((code) => setMs({ code })).then(onSignedIn, (e) => setError(errorMessage(e)));
    setMs(null);
  }

  return (
    <div className={s.form}>
      <p className={s.formHint}>Your licensed Minecraft: Java Edition, for online servers and Realms.</p>
      {ms?.code ? (
        <div className={s.code} role="status">
          <span className="subtle">Enter this code on the Microsoft page that opened in your browser. Didn’t open? Use the link below.</span>
          <div className={s.codeRow}>
            <strong className={cx("mono", "selectable")}>{ms.code.userCode}</strong>
            <IconButton
              icon={copied ? "check" : "content_copy"}
              label={copied ? "Copied" : "Copy code"}
              onClick={() => copy(ms.code!.userCode)}
            />
          </div>
          <Button variant="link" className={s.codeLink} onClick={() => openUrl(ms.code!.verificationUri)}>
            {ms.code.verificationUri.replace(/^https?:\/\//, "")}
          </Button>
        </div>
      ) : (
        <Button variant="primary" loading={!!ms} onClick={signIn}>{ms ? "Requesting code…" : "Sign in with Microsoft"}</Button>
      )}
      {error && <p className={s.error} role="alert">{error}</p>}
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
    <form className={s.form} onSubmit={(e) => (e.preventDefault(), submit())}>
      <p className={s.formHint}>{plugin.permissions.jvm ? `${plugin.description} Loads a Java agent into the game.` : plugin.description}</p>
      {plugin.account!.fields.map((f) => (
        <label key={f.key} className={s.field}>
          <span>{f.label}</span>
          <Input
            type={f.type === "secret" ? "password" : "text"}
            spellCheck={false}
            autoComplete="off"
            value={fields[f.key] ?? ""}
            onChange={(e) => setFields((v) => ({ ...v, [f.key]: e.target.value }))}
          />
          {f.hint && <span className={s.fieldHint}>{f.hint}</span>}
        </label>
      ))}
      <Button type="submit" variant="primary" loading={busy}>Sign in with {plugin.name}</Button>
      {error && <p className={s.error} role="alert">{error}</p>}
    </form>
  );
}
