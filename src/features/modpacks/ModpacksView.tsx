import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { memo, useEffect, useRef, useState } from "react";
import { getGameVersions, PACK_CATEGORIES, searchPacks, type PackFilters, type PackHit, type PackLoader, type PackSort } from "@/api/modrinth";
import { Banner } from "@/components/ui/Banner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { useDebounced } from "@/hooks/useDebounced";
import { ago, compact, errorMessage } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { PackDetail } from "./PackDetail";
import "./modpacks.css";

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
    <section className="view">
      {open && <PackDetail hit={open} preferredVersion={gameVersion} onBack={() => setOpen(null)} />}
      <div className="page packs" hidden={!!open}>
        <div className="packs-filters">
          <div className="packs-filter-row">
            <label className="search packs-search">
              <Icon name="search" />
              <input className="input" aria-label="Search modpacks" placeholder="Search modpacks" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <Select
              label="Minecraft version"
              className="packs-version"
              value={gameVersion}
              onChange={setGameVersion}
              placeholder="Loading versions…"
              options={[{ value: "", label: "Any version" }, ...(gameVersions.data ?? []).map((v) => ({ value: v, label: v }))]}
            />
            <div className="seg" role="group" aria-label="Loader">
              {LOADER_PILLS.map(([value, label]) => (
                <button key={label} className="pill" aria-pressed={loader === value} onClick={() => setLoader(value)}>
                  {label}
                </button>
              ))}
            </div>
            <Select label="Sort" className="packs-sort" value={sort} onChange={setSort} options={SORTS} />
          </div>
          <div className="packs-filter-row">
            <div className="pills" role="group" aria-label="Categories">
              {PACK_CATEGORIES.map(([key, label]) => (
                <button key={key} className="pill" aria-pressed={categories.includes(key)} onClick={() => toggleCategory(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="packs-summary" aria-live="polite">
          <span className="mono">{packs.data ? `${total.toLocaleString("en")} modpacks` : "Searching…"}</span>
          {filtered && (
            <button className="link" onClick={reset}>
              Clear filters
            </button>
          )}
        </div>

        <div className={`packs-list ${packs.isPlaceholderData ? "stale" : ""}`}>
          {packs.isError && !packs.data ? (
            <Banner message={`Modrinth search failed: ${errorMessage(packs.error)}`} onRetry={() => packs.refetch()} />
          ) : !packs.data ? (
            Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton" style={{ height: 124 }} />)
          ) : !hits.length ? (
            <EmptyState
              icon="search_off"
              action={filtered && <button className="btn" onClick={reset}>Clear filters</button>}
            >
              No Fabric or Quilt modpacks match these filters.
            </EmptyState>
          ) : (
            hits.map((h) => <PackRow key={h.project_id} hit={h} onOpen={setOpen} />)
          )}
          <div ref={sentinel} />
          {isFetchingNextPage && <div className="skeleton" style={{ height: 124 }} />}
          {packs.isFetchNextPageError && <Banner message="Could not load more modpacks." onRetry={() => fetchNextPage()} />}
        </div>
      </div>
    </section>
  );
}

const PackRow = memo(function PackRow({ hit: h, onOpen }: { hit: PackHit; onOpen(h: PackHit): void }) {
  const installing = useLauncher().imports.some((p) => p.projectId === h.project_id && !p.error);
  const loaders = h.categories.filter((c) => c === "fabric" || c === "quilt");
  const cats = h.categories.filter((c) => c in CATEGORY_LABEL);
  const mc = h.versions.length > 1 ? `${h.versions[0]} – ${h.versions.at(-1)}` : h.versions[0];
  return (
    <button className="pack-row" onClick={() => onOpen(h)} style={{ "--pack": packColor(h.color) } as React.CSSProperties}>
      <div className="pack-thumb">
        {h.featured_gallery ? <img src={h.featured_gallery} alt="" loading="lazy" /> : h.icon_url && <img className="blur" src={h.icon_url} alt="" loading="lazy" />}
      </div>
      <div className="pack-body">
        <div className="pack-title">
          <span className="pack-icon">{h.icon_url ? <img src={h.icon_url} alt="" loading="lazy" /> : <Icon name="inventory_2" />}</span>
          <strong>{h.title}</strong>
          <span className="by">by {h.author}</span>
          {installing && <span className="chip installing"><Icon name="progress_activity" spin />Installing</span>}
        </div>
        <p className="pack-desc">{h.description}</p>
        <div className="pack-meta">
          <span className="mono"><Icon name="download" />{compact(h.downloads)}</span>
          <span className="mono"><Icon name="favorite" />{compact(h.follows)}</span>
          <span><Icon name="update" />{ago(h.date_modified)}</span>
          {mc && <span className="chip tag">{mc}</span>}
          {loaders.map((l) => <span key={l} className="chip">{l === "fabric" ? "Fabric" : "Quilt"}</span>)}
          {cats.map((c) => <span key={c} className="chip ghost">{CATEGORY_LABEL[c]}</span>)}
        </div>
      </div>
      <Icon name="chevron_right" className="pack-chevron" />
    </button>
  );
});
