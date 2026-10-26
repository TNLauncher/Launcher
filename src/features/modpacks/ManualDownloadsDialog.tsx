import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Dialog, DialogText, Icon, ProgressBar } from "@/components/ui";
import { cx } from "@/lib/cx";
import { imports, useImportProgress, useManualOpen } from "@/store/imports";
import s from "./ManualDownloadsDialog.module.css";

/** Prism-style list of pack files whose authors block launchers: the user opens each page, the launcher picks the file up from Downloads. */
export function ManualDownloadsDialog() {
  const pending = useManualOpen();
  const { manual } = useImportProgress(pending?.projectId ?? "");
  const left = manual.filter((f) => !f.done);
  const got = manual.length - left.length;
  return (
    <Dialog
      open={!!pending}
      onClose={imports.hideManual}
      className={s.dialog}
      title={`Download ${manual.length === 1 ? "1 file" : `${manual.length} files`} for ${pending?.title ?? "this pack"}`}
      aside={<span className={s.count}>{got} / {manual.length}</span>}
      actions={
        <>
          <Button onClick={imports.hideManual}>Hide</Button>
          {left.length > 1 && (
            <Button variant="primary" icon="open_in_new" onClick={() => left.forEach((f) => void openUrl(f.page))}>
              Open {left.length} pages
            </Button>
          )}
        </>
      }
    >
      <DialogText>
        Their authors don't allow launchers to download them. Open each page and download the file; it moves into the pack as soon as it lands in Downloads.
      </DialogText>
      <ProgressBar value={manual.length ? got / manual.length : 0} />
      <ul className={s.list}>
        {manual.map((f) => (
          <li key={f.name} className={cx(s.file, f.done && s.done)}>
            <span className={s.status}>{f.done ? <Icon name="check_circle" fill /> : <span className={s.ring} />}</span>
            <span className={s.name} title={f.name}>{f.name}</span>
            {f.done ? (
              <span className={s.moved}>In the pack</span>
            ) : (
              <Button size="sm" icon="open_in_new" onClick={() => openUrl(f.page)}>Open page</Button>
            )}
          </li>
        ))}
      </ul>
      <p className={s.watch} aria-live="polite">
        {left.length ? (
          <>
            <span className={s.pulse} />
            Watching Downloads for {left.length === 1 ? "1 file" : `${left.length} files`}
          </>
        ) : (
          "All files are in. Finishing the install…"
        )}
      </p>
    </Dialog>
  );
}
