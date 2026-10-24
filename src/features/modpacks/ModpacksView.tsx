import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { getVersions } from "@/api/mojang";
import { sources, type Hit, type SourceInfo } from "@/api/sources";
import { View } from "@/components/layout/View";
import { Banner, Button, Chip, EmptyState, Icon, Pill, PillGroup, SearchInput, Select, Skeleton } from "@/components/ui";
import { cx } from "@/lib/cx";
import { useDebounced } from "@/hooks/useDebounced";
import { useFavorites, useSource } from "@/hooks/useSource";
import { SourcePicker } from "@/plugins/SourcePicker";
import { ago, compact, errorMessage, LOADERS } from "@/lib/format";
import { useInstalling } from "@/store/imports";
import s from "./modpacks.module.css";

/** Loaders the launcher can run modpacks on. */
const PACK_LOADERS = ["fabric", "quilt", "forge", "neoforge"] as const;
type PackLoader = "" | (typeof PACK_LOADERS)[number];
const LOADER_PILLS: [PackLoader, string][] = [["", "Any"], ...PACK_LOADERS.map((l): [PackLoader, string] => [l, LOADERS[l]])];
const PACK_PAGE = 20;

const releases = () => getVersions().then((vs) => vs.filter((v) => v.type === "release").map((v) => v.id));

// The detail page drags in marked + DOMPurify (most of this view's weight): load it when a pack is about to open.
const loadDetail = () => import("./PackDetail");
const PackDetail = lazy(() => loadDetail().then((m) => ({ default: m.PackDetail })));

export const packColor = (c: number | null) => (c == null ? undefined : `#${c.toString(16).padStart(6, "0")}`);

/** Modpack catalog of the content source; opening a pack swaps in its detail page and keeps the list (and scroll) alive underneath. */
export function ModpacksView() {
  const source = useSource();
  return (
    <View>
      {source?.categories.modpack ? (
        <Catalog key={source.id} source={source} />
      ) : (
        <>
          <SourcePicker className={s.sourcePicker} />
          <EmptyState icon="extension_off">Turn on a content source with modpacks in Settings → Plugins.</EmptyState>
        </>
      )}
    </View>
  );
}

function Catalog({ source }: { source: SourceInfo }) {
  const packCategories = source.categories.modpack ?? [];
  // Stable so memoized rows skip re-rendering while the user types.
  const categoryLabel = useMemo(() => Object.fromEntries(packCategories.map((c) => [c.id, c.label])), [packCategories]);
  const [query, setQuery] = useState("");
  const [gameVersion, setGameVersion] = useState("");
  const [loader, setLoader] = useState<PackLoader>("");
  const [categories, setCategories] = useState<string[]>([]);
  const [sort, setSort] = useState(source.sorts[0]?.id ?? "");
  const [open, setOpen] = useState<Hit | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  const favorites = useFavorites(source.id, "modpack");
  const debounced = useDebounced(query.trim(), 300);
  const filters = { query: debounced, gameVersion: gameVersion || undefined, loader: loader || undefined, categories, sort };
  const filtered = !!(debounced || gameVersion || loader || categories.length);

  const gameVersions = useQuery({ queryKey: ["game-versions"], queryFn: releases, staleTime: Infinity });
  const packs = useInfiniteQuery({
    queryKey: ["packs", source.id, filters],
    queryFn: ({ pageParam }) => sources.search(source.id, { kind: "modpack", ...filters, offset: pageParam, limit: PACK_PAGE }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.hits.length < last.total ? last.offset + last.hits.length : undefined),
    placeholderData: keepPreviousData,
  });
  const hits = packs.data?.pages.flatMap((p) => p.hits) ?? [];
  const total = packs.data?.pages[0]?.total ?? 0;

  // Load the next page when the end of the list scrolls into view; the sentinel is unmounted while favorites show.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = packs;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && !isFetchingNextPage && fetchNextPage(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, favOnly]);

  const toggleCategory = (c: string) => {
    setFavOnly(false);
    setCategories((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  };
  const reset = () => {
    setQuery("");
    setGameVersion("");
    setLoader("");
    setCategories([]);
  };

  return (
    <>
      {open && (
        <Suspense>
          <PackDetail source={source} hit={open} preferredVersion={gameVersion} onBack={() => setOpen(null)} />
        </Suspense>
      )}
      {/* Hovering any pack warms the detail chunk, so opening one doesn't wait on it. */}
      <div className={s.packs} hidden={!!open} onPointerOver={loadDetail} onFocus={loadDetail}>
        <div className={s.packsFilters}>
          <SourcePicker />
          <div className={s.packsFilterRow}>
            <SearchInput className={s.packsSearch} label="Search modpacks" value={query} onChange={setQuery} />
            <Select
              label="Minecraft version"
              className={s.packsVersion}
              value={gameVersion}
              onChange={setGameVersion}
              placeholder="Loading versions…"
              options={[{ value: "", label: "Any version" }, ...(gameVersions.data ?? []).map((v) => ({ value: v, label: v }))]}
            />
            <PillGroup label="Loader">
              {LOADER_PILLS.map(([value, label]) => (
                <Pill key={label} pressed={loader === value} onClick={() => setLoader(value)}>
                  {label}
                </Pill>
              ))}
            </PillGroup>
            <Select label="Sort" className={s.packsSort} value={sort} onChange={setSort} options={source.sorts.map((c) => ({ value: c.id, label: c.label }))} />
          </div>
          <div className={s.packsFilterRow}>
            <PillGroup label="Categories" wrap>
              <Pill pressed={favOnly} icon="star" count={favorites.hits.length} onClick={() => setFavOnly((f) => !f)}>
                Favorites
              </Pill>
              {packCategories.map((c) => (
                <Pill key={c.id} pressed={categories.includes(c.id)} onClick={() => toggleCategory(c.id)}>
                  {c.label}
                </Pill>
              ))}
            </PillGroup>
          </div>
        </div>

        {favOnly ? (
          <div className={s.packsList}>
            {favorites.hits.length ? (
              favorites.hits.map((h) => <PackRow key={h.id} hit={h} categoryLabel={categoryLabel} onOpen={setOpen} />)
            ) : (
              <EmptyState icon="star">No favorite modpacks yet. Open one and star it.</EmptyState>
            )}
          </div>
        ) : (
          <>
            <div className={s.packsSummary} aria-live="polite">
              <span className="mono">{packs.data ? `${total.toLocaleString("en")} modpacks` : "Searching…"}</span>
              {filtered && (
                <Button variant="link" onClick={reset}>
                  Clear filters
                </Button>
              )}
            </div>

            <div className={cx(s.packsList, packs.isPlaceholderData && s.stale)}>
              {packs.isError && !packs.data ? (
                <Banner message={`${source.name} search failed: ${errorMessage(packs.error)}`} onRetry={() => packs.refetch()} />
              ) : !packs.data ? (
                Array.from({ length: 5 }, (_, i) => <Skeleton key={i} height={124} />)
              ) : !hits.length ? (
                <EmptyState
                  icon="search_off"
                  action={filtered && <Button onClick={reset}>Clear filters</Button>}
                >
                  No modpacks match these filters.
                </EmptyState>
              ) : (
                hits.map((h) => <PackRow key={h.id} hit={h} categoryLabel={categoryLabel} onOpen={setOpen} />)
              )}
              <div ref={sentinel} />
              {isFetchingNextPage && <Skeleton height={124} />}
              {packs.isFetchNextPageError && <Banner message="Could not load more modpacks." onRetry={() => fetchNextPage()} />}
            </div>
          </>
        )}
      </div>
    </>
  );
}

const PackRow = memo(function PackRow({ hit: h, categoryLabel, onOpen }: { hit: Hit; categoryLabel: Record<string, string>; onOpen(h: Hit): void }) {
  const installing = useInstalling(h.id);
  const loaders = PACK_LOADERS.filter((l) => h.categories.includes(l));
  const cats = h.categories.filter((c) => c in categoryLabel);
  const mc = h.gameVersions.length > 1 ? `${h.gameVersions[0]} – ${h.gameVersions.at(-1)}` : h.gameVersions[0];
  return (
    <button className={cx(s.packRow, "sheen")} onClick={() => onOpen(h)} style={{ "--pack": packColor(h.color) } as React.CSSProperties}>
      <div className={s.packThumb}>
        {h.bannerUrl ? <img src={h.bannerUrl} alt="" loading="lazy" /> : h.iconUrl && <img className={s.blur} src={h.iconUrl} alt="" loading="lazy" />}
      </div>
      <div className={s.packBody}>
        <div className={s.packTitle}>
          <span className={s.packIcon}>{h.iconUrl ? <img src={h.iconUrl} alt="" loading="lazy" /> : <Icon name="inventory_2" />}</span>
          <strong>{h.title}</strong>
          <span className={s.by}>by {h.author}</span>
          {installing && <Chip variant="accent" icon="progress_activity" spin>Installing</Chip>}
        </div>
        <p className={s.packDesc}>{h.description}</p>
        <div className={s.packMeta}>
          <span className={cx(s.stat, "mono")}><Icon name="download" />{compact(h.downloads)}</span>
          <span className={cx(s.stat, "mono")}><Icon name="favorite" />{compact(h.follows)}</span>
          <span className={s.stat}><Icon name="update" />{ago(h.updated)}</span>
          {mc && <Chip variant="tag">{mc}</Chip>}
          {loaders.map((l) => <Chip key={l}>{LOADERS[l]}</Chip>)}
          {cats.map((c) => <Chip key={c} variant="ghost">{categoryLabel[c]}</Chip>)}
        </div>
      </div>
      <Icon name="chevron_right" className={s.packChevron} />
    </button>
  );
});
