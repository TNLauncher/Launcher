import { getCurrentWindow } from "@tauri-apps/api/window";
import { Component, useState, type ReactNode } from "react";
import { BackendError } from "@/api/ipc";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { cx } from "@/lib/cx";
import s from "./ErrorBoundary.module.css";

interface Props {
  children: ReactNode;
  /** Whole window: the titlebar is gone with the tree, so the fallback brings its own drag strip and close button. */
  full?: boolean;
}

/** Catches render crashes (and errors rethrown into render) so one broken screen doesn't blank the launcher. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e : new Error(String(e)) };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <Fallback error={error} full={this.props.full} onReset={() => this.setState({ error: null })} />;
  }
}

// A failed lazy import means the bundle changed under us (dev reload) or the file is gone: only a reload helps.
const isChunkError = (e: Error) => /dynamically imported module|Importing a module script failed|error loading dynamically/i.test(e.message);

function headline(e: Error) {
  if (isChunkError(e)) return "This screen didn't load";
  if (e instanceof BackendError) return e.kind === "network" ? "Couldn't reach the network" : "The launcher couldn't finish that";
  return "Something broke on this screen";
}

function Fallback({ error, full, onReset }: { error: Error; full?: boolean; onReset(): void }) {
  const [copied, setCopied] = useState(false);
  const chunk = isChunkError(error);
  const kind = error instanceof BackendError ? error.kind : error.name;
  const report = `${kind}: ${error.message}\n\n${error.stack ?? ""}`.trim();

  const copy = () =>
    navigator.clipboard.writeText(report).then(
      () => (setCopied(true), setTimeout(() => setCopied(false), 1600)),
      () => {}
    );

  return (
    <div className={cx(s.wrap, full && s.full)} role="alert">
      {full && (
        <header className={s.drag} data-tauri-drag-region>
          <button className={s.close} aria-label="Close" onClick={() => getCurrentWindow().close()}>
            <Icon name="close" />
          </button>
        </header>
      )}
      <div className={s.panel}>
        <span className={s.mark}>
          <Icon name={chunk ? "cloud_off" : "bug_report"} fill />
        </span>
        <h2 className={s.title}>{headline(error)}</h2>
        <p className={s.lead}>
          {full ? "Nothing was deleted: your instances and worlds are safe on disk. Try again, or reload if it keeps happening." : "The rest of the launcher still works. Try again, or switch to another tab."}
        </p>
        <p className={cx(s.message, "selectable")}>{error.message || "Unknown error"}</p>
        <div className={s.actions}>
          {chunk ? (
            <Button variant="primary" icon="refresh" onClick={() => location.reload()}>
              Reload launcher
            </Button>
          ) : (
            <>
              <Button variant="primary" icon="refresh" onClick={onReset}>
                Try again
              </Button>
              {full && (
                <Button icon="restart_alt" onClick={() => location.reload()}>
                  Reload launcher
                </Button>
              )}
            </>
          )}
          <Button icon={copied ? "check" : "content_copy"} onClick={copy}>
            {copied ? "Copied" : "Copy details"}
          </Button>
        </div>
        {error.stack && (
          <details className={s.details}>
            <summary>
              <Icon name="chevron_right" />
              Technical details
              <span className={s.kind}>{kind}</span>
            </summary>
            <pre className={cx(s.stack, "mono selectable")}>{error.stack}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
