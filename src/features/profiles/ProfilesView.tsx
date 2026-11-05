import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { View } from "@/components/layout/View";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, ConfirmDialog, Dot, Icon, IconButton, Input, Menu, Skeleton } from "@/components/ui";
import { launcher } from "@/api/launcher";
import { type PluginEntry } from "@/api/sources";
import { usePlugins } from "@/hooks/useSource";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import type { Account, DeviceCode } from "@/types";
import { SkinHead, useSkin } from "./Skin";
import { SkinModel } from "./SkinModel";
import s from "./profiles.module.css";

/** Player accounts: the one launches use on a turntable, every signed-in one to switch to, and sign-in. */
export function ProfilesView() {
  const loaded = useLauncher((st) => st.snapshot !== null);
  const active = useLauncher((st) => st.snapshot?.account ?? null);
  const refresh = useLauncher((st) => st.refresh);
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: launcher.listAccounts });
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<Account | null>(null);
  const [spinning, setSpinning] = useState(false);
  const refreshing = useRef(false);

  // A new sign-in may bring a new skin for the same player.
  const done = () =>
    Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["accounts"] }), qc.invalidateQueries({ queryKey: ["skin"] })]).then(() => setError(""));
  const act = (p: Promise<unknown>) => p.then(done, (e) => setError(errorMessage(e)));
  const refreshSkins = () => {
    if (spinning) return;
    refreshing.current = true;
    setSpinning(true);
    void qc.invalidateQueries({ queryKey: ["skin"] }).finally(() => (refreshing.current = false));
  };

  if (!loaded) return <View />;

  return (
    <View className={s.view}>
      <Stage account={active} />

      <div className={s.side}>
        <div className={s.sideHead}>
          <h1>Profiles</h1>
          <IconButton
            icon="refresh"
            label="Refresh skins"
            disabled={!accounts.data?.length}
            className={cx(spinning && s.spinning)}
            onClick={refreshSkins}
            onAnimationIteration={() => !refreshing.current && setSpinning(false)}
            onAnimationEnd={() => setSpinning(false)}
          />
        </div>

        {accounts.isPending ? (
          <ul className={s.list} aria-label="Profiles">
            {[0, 1].map((i) => <li key={i}><Skeleton height={56} /></li>)}
          </ul>
        ) : accounts.data?.length ? (
          <ul className={s.list} aria-label="Profiles">
            {accounts.data.map((a) => (
              <ProfileRow key={a.id} account={a} selected={a.selected} onUse={() => act(launcher.selectAccount(a.id))} onRemove={() => setRemoving(a)} onEdited={done} />
            ))}
          </ul>
        ) : (
          <p className="subtle">No profiles yet. Sign in below to launch the game.</p>
        )}
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
const modelScale = () =>
  window.innerWidth <= 1000 ? 8 : Math.max(8, Math.min(13, Math.floor((window.innerHeight - 40) / 64)));

function useModelScale() {
  const [px, setPx] = useState(modelScale);
  useEffect(() => {
    const onResize = () => setPx(modelScale());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return px;
}

/** The active profile on a turntable. */
function Stage({ account }: { account: Account | null }) {
  const skin = useSkin(account);
  const name = account?.name ?? "No profile";
  const px = useModelScale();
  const [turned, setTurned] = useState(false);
  return (
    <section className={s.stage} aria-label="Active profile">
      <div className={s.turntable}>
        <SkinModel skin={skin} px={px} label={account ? `${account.name}'s skin` : "Default skin"} onTurn={() => setTurned(true)} />
        <div className={s.floor} />
      </div>
      <span className={s.hint} data-gone={turned || undefined} aria-hidden>Drag to turn · double-click to reset</span>

      <div className={s.identity}>
        <h2 className={cx(s.name, "selectable")}>{name}</h2>
        <div className={s.status}>
          <Dot tone={account ? "green" : "neutral"} />
          {account ? `Signed in with ${account.providerName} · used for every launch` : "Not signed in · add a profile to play"}
        </div>
        {account && <Uuid uuid={account.uuid} />}
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

function ProfileRow(p: { account: Account; selected: boolean; onUse(): void; onRemove(): void; onEdited(): Promise<unknown> }) {
  const { account, selected } = p;
  const skin = useSkin(account);
  // Plugin accounts edit through their provider's own sign-in form; Microsoft names live with Microsoft.
  const plugin = usePlugins().data?.find((x) => x.id === account.provider && x.enabled && x.account);
  const [editing, setEditing] = useState(false);
  return (
    <li>
      <div className={s.row}>
        <button type="button" className={cx(s.pick, "sheen")} aria-pressed={selected} onClick={selected ? undefined : p.onUse}>
          <SkinHead skin={skin} name={account.name} size={36} />
          <span className={s.rowText}>
            <span className={s.rowName}>{account.name}</span>
            <span className={s.rowSub}>{account.providerName}</span>
          </span>
          {selected ? (
            <span className={s.current}><Icon name="check_circle" fill />Active</span>
          ) : (
            <span className={s.use}>Use</span>
          )}
        </button>
        <div className={s.rowMenu}>
          <Menu
            label={`${account.name} actions`}
            items={[
              ...(plugin ? [{ icon: "edit", label: "Edit", onSelect: () => setEditing(true) }] : []),
              { icon: "delete", label: "Remove", danger: true, divide: !!plugin, onSelect: p.onRemove },
            ]}
          />
        </div>
      </div>
      {editing && plugin && (
        <div className={s.edit}>
          <PluginSignIn plugin={plugin} account={account.id} onSignedIn={() => p.onEdited().then(() => setEditing(false))} onCancel={() => setEditing(false)} />
        </div>
      )}
    </li>
  );
}

/** Every way to sign in, right under the list: Microsoft starts on one click, a provider plugin opens its form in place. */
function AddProfile({ onSignedIn }: { onSignedIn(): Promise<unknown> }) {
  const providers = (usePlugins().data ?? []).filter((p) => p.enabled && p.account);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className={s.add} aria-labelledby="add-profile">
      <h2 id="add-profile" className={s.addTitle}>Add a profile</h2>
      <ul className={s.list}>
        <MicrosoftSignIn onSignedIn={onSignedIn} />
        {providers.map((p) => (
          <ProviderRow
            key={p.id}
            name={p.name}
            hint={p.permissions.jvm ? `${p.description} Loads a Java agent into the game.` : p.description}
            icon="expand_more"
            open={open === p.id}
            onClick={() => setOpen(open === p.id ? null : p.id)}
          >
            {open === p.id && <PluginSignIn plugin={p} onSignedIn={() => onSignedIn().then(() => setOpen(null))} />}
          </ProviderRow>
        ))}
      </ul>
    </section>
  );
}

/** One sign-in method; `open` marks a row that discloses a form, rather than one that acts directly. */
function ProviderRow(p: { name: string; hint: string; icon: string; busy?: boolean; open?: boolean; onClick(): void; children?: ReactNode }) {
  return (
    <li className={s.provider}>
      <button type="button" className={cx(s.providerHead, "sheen")} aria-expanded={p.open} disabled={p.busy} onClick={p.onClick}>
        <span className={s.rowText}>
          <span className={s.rowName}>{p.name}</span>
          <span className={s.rowSub}>{p.hint}</span>
        </span>
        <Icon name={p.busy ? "progress_activity" : p.icon} spin={p.busy} />
      </button>
      {p.children && <div className={s.providerBody}>{p.children}</div>}
    </li>
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
    <ProviderRow
      name="Microsoft"
      hint={ms?.code ? "Waiting for you to finish in the browser…" : "Your licensed Minecraft: Java Edition, for online servers and Realms."}
      icon="arrow_forward"
      busy={!!ms}
      onClick={signIn}
    >
      {ms?.code && (
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
      )}
      {error && <p className={s.error} role="alert">{error}</p>}
    </ProviderRow>
  );
}

/** The sign-in form an account provider plugin declares; with `account`, it signs that account in again in place. */
function PluginSignIn({ plugin, account, onSignedIn, onCancel }: { plugin: PluginEntry; account?: string; onSignedIn(): Promise<unknown>; onCancel?(): void }) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = () => {
    setBusy(true);
    launcher
      .pluginLogin(plugin.id, fields, account)
      .then(() => (setFields({}), setError(""), onSignedIn()), (e) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };
  return (
    <form className={s.form} onSubmit={(e) => (e.preventDefault(), submit())} onKeyDown={(e) => e.key === "Escape" && onCancel?.()}>
      {plugin.account!.fields.map((f, i) => (
        <label key={f.key} className={s.field}>
          <span>{f.label}</span>
          <Input
            type={f.type === "secret" ? "password" : "text"}
            autoFocus={i === 0}
            spellCheck={false}
            autoComplete="off"
            value={fields[f.key] ?? ""}
            onChange={(e) => setFields((v) => ({ ...v, [f.key]: e.target.value }))}
          />
          {f.hint && <span className={s.fieldHint}>{f.hint}</span>}
        </label>
      ))}
      {error && <p className={s.error} role="alert">{error}</p>}
      {onCancel ? (
        <div className={s.formActions}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Save</Button>
        </div>
      ) : (
        <Button type="submit" variant="primary" loading={busy}>Sign in with {plugin.name}</Button>
      )}
    </form>
  );
}
