import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { memo, useEffect, useRef, useState } from "react";
import { getGameVersions, PACK_CATEGORIES, searchPacks, type PackFilters, type PackHit, type PackLoader, type PackSort } from "@/api/modrinth";
import { View } from "@/components/layout/View";
import { Banner, Button, Chip, EmptyState, Icon, Pill, PillGroup, SearchInput, Select, Skeleton } from "@/components/ui";
import { cx } from "@/lib/cx";
import { useDebounced } from "@/hooks/useDebounced";
import { ago, compact, errorMessage } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { PackDetail } from "./PackDetail";
import s from "./modpacks.module.css";

const SORTS: { value: PackSort; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "downloads", label: "Downloads" },
  { value: "follows", label: "Followers" },
  { value: "updated", label: "Recently updated" },
  { value: "newest", label: "Newest" },
];
const LOADER_PILLS: [PackLoader | "", string][] = [["", "Any"], ["fabric", "Fabric"], ["quilt", "Quilt"]];
const CATEGORY_LABEL = Object.fromEntries(PACK_CATEGORIES);

export const packColor = (c: number | null) => (c == null ? undefined : `#${c.toString(16).padStart(6, "0")}`);

/** Modrinth modpack catalog; opening a pack swaps in its detail page and keeps the list (and scroll) alive underneath. */
export function ModpacksView() {
  const [query, setQuery] = useState("");
  const [gameVersion, setGameVersion] = useState("");
  const [loader, setLoader] = useState<PackLoader | "">("");
  const [categories, setCategories] = useState<string[]>([]);
  const [sort, setSort] = useState<PackSort>("relevance");
  const [open, setOpen] = useState<PackHit | null>(null);
  const debounced = useDebounced(query.trim(), 300);
  const filters: PackFilters = { query: debounced, gameVersion, loader, categories, sort };
  const filtered = !!(debounced || gameVersion || loader || categories.length);

  const gameVersions = useQuery({ queryKey: ["game-versions"], queryFn: getGameVersions, staleTime: Infinity });
  const packs = useInfiniteQuery({
    queryKey: ["packs", filters],
    queryFn: ({ pageParam }) => searchPacks(filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.hits.length < last.total_hits ? last.offset + last.hits.length : undefined),
    placeholderData: keepPreviousData,
  });
  const hits = packs.data?.pages.flatMap((p) => p.hits) ?? [];
  const total = packs.data?.pages[0]?.total_hits ?? 0;

  // Load the next page when the end of the list scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = packs;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && !isFetchingNextPage && fetchNextPage(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const toggleCategory = (c: string) => setCategories((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  const reset = () => {
    setQuery("");
    setGameVersion("");
    setLoader("");
    setCategories([]);
  };

  return (
    <View>
      {open && <PackDetail hit={open} preferredVersion={gameVersion} onBack={() => setOpen(null)} />}
      <div className={s.packs} hidden={!!open}>
        <div className={s.packsFilters}>
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
            <Select label="Sort" className={s.packsSort} value={sort} onChange={setSort} options={SORTS} />
          </div>
          <div className={s.packsFilterRow}>
            <PillGroup label="Categories" wrap>
              {PACK_CATEGORIES.map(([key, label]) => (
                <Pill key={key} pressed={categories.includes(key)} onClick={() => toggleCategory(key)}>
                  {label}
                </Pill>
              ))}
            </PillGroup>
          </div>
        </div>

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
            <Banner message={`Modrinth search failed: ${errorMessage(packs.error)}`} onRetry={() => packs.refetch()} />
          ) : !packs.data ? (
            Array.from({ length: 5 }, (_, i) => <Skeleton key={i} height={124} />)
          ) : !hits.length ? (
            <EmptyState
              icon="search_off"
              action={filtered && <Button onClick={reset}>Clear filters</Button>}
            >
              No Fabric or Quilt modpacks match these filters.
            </EmptyState>
          ) : (
            hits.map((h) => <PackRow key={h.project_id} hit={h} onOpen={setOpen} />)
          )}
          <div ref={sentinel} />
          {isFetchingNextPage && <Skeleton height={124} />}
          {packs.isFetchNextPageError && <Banner message="Could not load more modpacks." onRetry={() => fetchNextPage()} />}
        </div>
      </div>
    </View>
  );
}

const PackRow = memo(function PackRow({ hit: h, onOpen }: { hit: PackHit; onOpen(h: PackHit): void }) {
  const installing = useLauncher().imports.some((p) => p.projectId === h.project_id && !p.error);
  const loaders = h.categories.filter((c) => c === "fabric" || c === "quilt");
  const cats = h.categories.filter((c) => c in CATEGORY_LABEL);
  const mc = h.versions.length > 1 ? `${h.versions[0]} – ${h.versions.at(-1)}` : h.versions[0];
  return (
    <button className={s.packRow} onClick={() => onOpen(h)} style={{ "--pack": packColor(h.color) } as React.CSSProperties}>
      <div className={s.packThumb}>
        {h.featured_gallery ? <img src={h.featured_gallery} alt="" loading="lazy" /> : h.icon_url && <img className={s.blur} src={h.icon_url} alt="" loading="lazy" />}
      </div>
      <div className={s.packBody}>
        <div className={s.packTitle}>
          <span className={s.packIcon}>{h.icon_url ? <img src={h.icon_url} alt="" loading="lazy" /> : <Icon name="inventory_2" />}</span>
          <strong>{h.title}</strong>
          <span className={s.by}>by {h.author}</span>
          {installing && <Chip variant="accent" icon="progress_activity" spin>Installing</Chip>}
        </div>
        <p className={s.packDesc}>{h.description}</p>
        <div className={s.packMeta}>
          <span className={cx(s.stat, "mono")}><Icon name="download" />{compact(h.downloads)}</span>
          <span className={cx(s.stat, "mono")}><Icon name="favorite" />{compact(h.follows)}</span>
          <span className={s.stat}><Icon name="update" />{ago(h.date_modified)}</span>
          {mc && <Chip variant="tag">{mc}</Chip>}
          {loaders.map((l) => <Chip key={l}>{l === "fabric" ? "Fabric" : "Quilt"}</Chip>)}
          {cats.map((c) => <Chip key={c} variant="ghost">{CATEGORY_LABEL[c]}</Chip>)}
        </div>
      </div>
      <Icon name="chevron_right" className={s.packChevron} />
    </button>
  );
});
