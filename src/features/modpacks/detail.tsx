import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import type { GalleryImage, Project, Version } from "@/api/sources";
import { Chip, Dialog, EmptyState, Icon, IconButton, Skeleton } from "@/components/ui";
import { Markdown } from "@/components/ui/Markdown";
import { cx } from "@/lib/cx";
import { dateLabel, loaderList } from "@/lib/format";
import s from "./modpacks.module.css";

/** Parts shared by the modpack page and the mod / resource pack / shader page. */

export function About({ project: p }: { project: Project }) {
  return (
    <div className={s.sideCard}>
      <h2>About</h2>
      <dl className={s.installFacts}>
        <dt>Published</dt>
        <dd>{dateLabel(p.published)}</dd>
        {p.license && (
          <>
            <dt>License</dt>
            <dd>{p.license}</dd>
          </>
        )}
      </dl>
      <div className={s.sideLinks}>
        {p.links.map((l) => (
          <button key={l.label} className={s.sideLink} onClick={() => openUrl(l.url)}>
            <Icon name={l.icon} />
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Gallery({ images }: { images: GalleryImage[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const close = () => setIndex(null);
  const shown = index == null ? null : images[index];
  const step = (d: number) => setIndex((i) => (i == null ? i : (i + d + images.length) % images.length));

  return (
    <>
      <div className={s.gallery}>
        {images.map((img, i) => (
          <button key={img.url} className={s.galleryItem} onClick={() => setIndex(i)}>
            <img src={img.url} alt={img.title ?? ""} loading="lazy" />
            {img.title && <span>{img.title}</span>}
          </button>
        ))}
      </div>
      <Dialog
        open={index != null}
        className={s.lightbox}
        aria-label="Screenshot"
        onClose={close}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") step(1);
          if (e.key === "ArrowLeft") step(-1);
        }}
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        {shown && (
          <figure>
            <img src={shown.rawUrl} alt={shown.title ?? ""} />
            <figcaption>
              <div>
                {shown.title && <b>{shown.title}</b>}
                {shown.description && <span>{shown.description}</span>}
              </div>
              <div className={s.lightboxNav}>
                <span className={cx(s.lightboxCount, "mono")}>{(index ?? 0) + 1} / {images.length}</span>
                <IconButton icon="chevron_left" label="Previous" onClick={() => step(-1)} />
                <IconButton icon="chevron_right" label="Next" onClick={() => step(1)} />
                <IconButton icon="close" label="Close" onClick={close} />
              </div>
            </figcaption>
          </figure>
        )}
      </Dialog>
    </>
  );
}

export function VersionList({
  versions,
  loading,
  empty,
  installedVersionId,
  selected,
  onSelect,
}: {
  versions: Version[];
  loading: boolean;
  empty: string;
  installedVersionId?: string;
  selected?: Version;
  onSelect(v: Version): void;
}) {
  if (loading) return <TextSkeleton />;
  if (!versions.length) return <EmptyState icon="history">{empty}</EmptyState>;
  return (
    <div className={s.versions}>
      {versions.map((v) => {
        const on = v.id === selected?.id;
        return (
          <div key={v.id} className={cx(s.version, on && s.on)}>
            <button className={s.versionHead} aria-expanded={on} onClick={() => onSelect(v)}>
              <span className={cx(s.vtype, s[v.channel])} title={v.channel}>{v.channel[0].toUpperCase()}</span>
              <span className={s.versionName}>
                <b>{v.number}</b>
                <span>{v.name}</span>
              </span>
              {v.id === installedVersionId && <Chip variant="accent">Installed</Chip>}
              <Chip variant="tag" className={s.versionTag}>{v.gameVersions.join(", ")}</Chip>
              {v.loaders.length > 0 && <Chip>{loaderList(v.loaders)}</Chip>}
              <span className={s.versionDate}>{dateLabel(v.published)}</span>
              {on && <Icon name="check_circle" fill className={s.versionCheck} />}
            </button>
            {on && (
              <div className={s.versionBody}>
                {v.changelog?.trim() ? <Markdown source={v.changelog} /> : <p className={s.note}>No changelog for this version.</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TextSkeleton() {
  return (
    <div className={s.textSkeleton}>
      {[92, 100, 76, 0, 100, 88, 64].map((w, i) => (w ? <Skeleton key={i} className={s.line} height={12} width={`${w}%`} /> : <span key={i} />))}
    </div>
  );
}
