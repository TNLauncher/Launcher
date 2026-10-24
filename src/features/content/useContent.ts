import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { launcher } from "@/api/launcher";
import { sources, type ProjectSummary, type Version } from "@/api/sources";
import { toast } from "@/components/ui";
import { useSource } from "@/hooks/useSource";
import { errorMessage, plural } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import type { ContentKind, Instance, ModFile } from "@/types";

export interface ContentItem extends ModFile {
  /** Set when the content source recognises the file by its hash. */
  project?: ProjectSummary;
  versionNumber?: string;
  /** Compatible versions available on the content source for this instance, newest first. */
  versions?: Version[];
  /** Currently installed version object when matched against `versions`. */
  currentVersion?: Version;
  /** Newest compatible version on the source. */
  latestVersion?: Version;
  /** True when `latestVersion` is newer than the installed build. */
  hasUpdate?: boolean;
}

const stripDisabled = (file: string) => file.replace(/\.disabled$/, "");

/** Matches an installed file against the source's version list for its project. */
export function matchInstalledVersion(file: string, versionNumber: string | undefined, versions: Version[]): Version | undefined {
  const plain = stripDisabled(file);
  return (
    versions.find((v) => v.files.some((f) => f.filename === plain)) ??
    (versionNumber ? versions.find((v) => v.number === versionNumber || v.name === versionNumber) : undefined)
  );
}

/** Fetches compatible versions for a project, falling back to any game version for packs/shaders when none are tagged for the exact release. */
export async function fetchCompatibleVersions(source: string, project: string, kind: ContentKind, gameVersion: string, loader: string): Promise<Version[]> {
  let list = await sources.versions(source, project, { kind, gameVersion, loader });
  if (!list.length && kind !== "mod") {
    list = await sources.versions(source, project, { kind, loader });
  }
  return list;
}

/**
 * Files of one kind in an instance, enriched with their project and available versions on the content source.
 * The backend hashes the files and asks the source; cached on the file list's names and sizes.
 */
export function useContent(instance: Instance, kind: ContentKind, identify = true) {
  const instanceId = instance.id;
  const qc = useQueryClient();
  const refresh = useLauncher((st) => st.refresh);
  const source = useSource()?.id;
  const [busyFiles, setBusyFiles] = useState<Set<string>>(() => new Set());
  const [updatingAll, setUpdatingAll] = useState(false);

  const files = useQuery({ queryKey: ["content", instanceId, kind], queryFn: () => launcher.listContent(instanceId, kind) });

  const signature = files.data?.map((f) => `${f.file}:${f.size}`).join("|") ?? "";
  const known = useQuery({
    queryKey: ["content-identify", source, instanceId, kind, signature],
    queryFn: () => sources.identifyContent(source!, instanceId, kind),
    enabled: identify && !!source && !!files.data?.length,
    staleTime: Infinity,
  });

  const projectIds = useMemo(() => {
    if (!known.data) return [];
    return [...new Set(Object.values(known.data).map((k) => k.project.id))].sort();
  }, [known.data]);

  const versionQueries = useQueries({
    queries: projectIds.map((pid) => ({
      queryKey: ["content-versions", source, pid, kind, instance.version, instance.loader],
      queryFn: () => fetchCompatibleVersions(source!, pid, kind, instance.version, instance.loader),
      enabled: identify && !!source,
      staleTime: 5 * 60_000,
    })),
  });

  const versionsByProject = useMemo(() => {
    const map = new Map<string, Version[]>();
    projectIds.forEach((pid, idx) => {
      const data = versionQueries[idx]?.data;
      if (data) map.set(pid, data);
    });
    return map;
  }, [projectIds, versionQueries]);

  const checkingVersions = versionQueries.some((q) => q.isFetching);

  const items = useMemo<ContentItem[] | undefined>(() => {
    if (!files.data) return undefined;
    return files.data
      .map((f) => {
        const k = known.data?.[f.file];
        const versions = k ? versionsByProject.get(k.project.id) : undefined;
        const currentVersion = versions ? matchInstalledVersion(f.file, k?.versionNumber, versions) : undefined;
        const latestVersion = versions?.[0];
        const plain = stripDisabled(f.file);
        const hasUpdate =
          !!latestVersion &&
          !!k &&
          (currentVersion
            ? latestVersion.id !== currentVersion.id
            : latestVersion.number !== k.versionNumber && !latestVersion.files.some((vf) => vf.filename === plain));
        return {
          ...f,
          project: k?.project,
          versionNumber: k?.versionNumber,
          versions,
          currentVersion,
          latestVersion,
          hasUpdate,
        };
      })
      .sort((a, b) => label(a).localeCompare(label(b)));
  }, [files.data, known.data, versionsByProject]);

  const installedProjects = useMemo(() => new Set(items?.flatMap((i) => (i.project ? [i.project.id] : []))), [items]);
  const installedRef = useRef(installedProjects);
  installedRef.current = installedProjects;

  const updatableItems = useMemo(() => (items ?? []).filter((i) => i.hasUpdate && i.project && i.latestVersion), [items]);

  const reload = useCallback(() => qc.invalidateQueries({ queryKey: ["content", instanceId, kind] }), [qc, instanceId, kind]);

  const switchVersion = useCallback(
    async (item: ContentItem, versionId: string) => {
      if (!source || !item.project) return;
      setBusyFiles((prev) => new Set(prev).add(item.file));
      try {
        await sources.installContent(source, instanceId, kind, item.project.id, [...installedRef.current], {
          version: versionId,
          replace: item.file,
        });
        await reload();
        refresh();
      } finally {
        setBusyFiles((prev) => {
          const next = new Set(prev);
          next.delete(item.file);
          return next;
        });
      }
    },
    [source, instanceId, kind, reload, refresh]
  );

  const updateItem = useCallback(
    async (item: ContentItem) => {
      if (!item.latestVersion) return;
      await switchVersion(item, item.latestVersion.id);
    },
    [switchVersion]
  );

  const updateAll = useCallback(async () => {
    if (!source || !updatableItems.length) return 0;
    setUpdatingAll(true);
    let count = 0;
    try {
      for (const item of updatableItems) {
        if (!item.project || !item.latestVersion) continue;
        setBusyFiles((prev) => new Set(prev).add(item.file));
        try {
          await sources.installContent(source, instanceId, kind, item.project.id, [...installedRef.current], {
            version: item.latestVersion.id,
            replace: item.file,
          });
          count++;
        } finally {
          setBusyFiles((prev) => {
            const next = new Set(prev);
            next.delete(item.file);
            return next;
          });
        }
      }
      await reload();
      refresh();
      return count;
    } finally {
      setUpdatingAll(false);
    }
  }, [source, updatableItems, instanceId, kind, reload, refresh]);

  return {
    items,
    error: files.error,
    /** Still matching files against the source; names fall back to file names meanwhile. */
    identifying: known.isFetching,
    checkingVersions,
    installedProjects,
    updatableCount: updatableItems.length,
    busyFiles,
    updatingAll,
    switchVersion,
    updateItem,
    updateAll,
    reload,
  };
}

/**
 * Checks and updates all content (mods, resource packs, shaders) in an instance at once.
 * Works both when panes are already loaded and on-demand from the instance header.
 */
export function useInstanceBulkUpdate(instance: Instance) {
  const qc = useQueryClient();
  const refresh = useLauncher((st) => st.refresh);
  const source = useSource()?.id;
  const [busy, setBusy] = useState(false);

  const runUpdateAll = useCallback(async () => {
    if (!source || busy) return;
    setBusy(true);
    try {
      const kinds: ContentKind[] = instance.loader === "vanilla" ? ["resourcepack"] : ["mod", "resourcepack", "shader"];
      let updatedTotal = 0;

      for (const kind of kinds) {
        const fileList = await qc.fetchQuery({
          queryKey: ["content", instance.id, kind],
          queryFn: () => launcher.listContent(instance.id, kind),
        });
        if (!fileList.length) continue;

        const sig = fileList.map((f) => `${f.file}:${f.size}`).join("|");
        const identified = await qc.fetchQuery({
          queryKey: ["content-identify", source, instance.id, kind, sig],
          queryFn: () => sources.identifyContent(source, instance.id, kind),
          staleTime: Infinity,
        });

        const installedIds = [...new Set(Object.values(identified).map((k) => k.project.id))];
        for (const f of fileList) {
          const k = identified[f.file];
          if (!k) continue;
          const versions = await qc.fetchQuery({
            queryKey: ["content-versions", source, k.project.id, kind, instance.version, instance.loader],
            queryFn: () => fetchCompatibleVersions(source, k.project.id, kind, instance.version, instance.loader),
            staleTime: 5 * 60_000,
          });
          const latest = versions[0];
          if (!latest) continue;
          const current = matchInstalledVersion(f.file, k.versionNumber, versions);
          const plain = stripDisabled(f.file);
          const needsUpdate = current
            ? latest.id !== current.id
            : latest.number !== k.versionNumber && !latest.files.some((vf) => vf.filename === plain);
          if (needsUpdate) {
            await sources.installContent(source, instance.id, kind, k.project.id, installedIds, {
              version: latest.id,
              replace: f.file,
            });
            updatedTotal++;
          }
        }
        await qc.invalidateQueries({ queryKey: ["content", instance.id, kind] });
      }

      refresh();
      if (updatedTotal > 0) {
        toast(`Updated ${plural(updatedTotal, "item")} in ${instance.name}`);
      } else {
        toast(`All mods, resource packs and shaders are up to date`, "info");
      }
    } catch (e) {
      toast(`Update failed: ${errorMessage(e)}`, "critical");
    } finally {
      setBusy(false);
    }
  }, [source, busy, instance, qc, refresh]);

  return { busy, canUpdate: !!source, runUpdateAll };
}

/** What to call a file: its project title, else the file name without extensions. */
export const label = (i: ContentItem) => i.project?.title ?? i.file.replace(/\.(jar|zip)(\.disabled)?$/, "");
