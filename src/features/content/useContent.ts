import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { launcher } from "@/api/launcher";
import { getProjectsChunked, identifyFiles, type ProjectSummary } from "@/api/modrinth";
import type { ContentKind, ModFile } from "@/types";

export interface ContentItem extends ModFile {
  /** Set when Modrinth recognises the file by its hash. */
  project?: ProjectSummary;
  versionNumber?: string;
}

/**
 * Files of one kind in an instance, enriched with their Modrinth project.
 * Chain: list → SHA-1 per file → /version_files → /projects; each step is cached on its inputs.
 */
export function useContent(instanceId: string, kind: ContentKind) {
  const qc = useQueryClient();
  const files = useQuery({ queryKey: ["content", instanceId, kind], queryFn: () => launcher.listContent(instanceId, kind) });

  const signature = files.data?.map((f) => `${f.file}:${f.size}`).join("|") ?? "";
  const hashes = useQuery({
    queryKey: ["content-hashes", instanceId, kind, signature],
    queryFn: () => launcher.hashContent(instanceId, kind),
    enabled: !!files.data?.length,
    staleTime: Infinity,
  });

  const hashList = useMemo(() => [...new Set(Object.values(hashes.data ?? {}))].sort(), [hashes.data]);
  const versions = useQuery({
    queryKey: ["version-files", hashList],
    queryFn: () => identifyFiles(hashList),
    enabled: hashList.length > 0,
    staleTime: Infinity,
  });

  const projectIds = useMemo(() => [...new Set(Object.values(versions.data ?? {}).map((v) => v.project_id))].sort(), [versions.data]);
  const projects = useQuery({
    queryKey: ["projects", projectIds],
    queryFn: () => getProjectsChunked(projectIds),
    enabled: projectIds.length > 0,
    staleTime: Infinity,
  });

  const items = useMemo<ContentItem[] | undefined>(() => {
    if (!files.data) return undefined;
    const byId = new Map(projects.data?.map((p) => [p.id, p]));
    return files.data
      .map((f) => {
        const v = versions.data?.[hashes.data?.[f.file] ?? ""];
        return { ...f, project: v && byId.get(v.project_id), versionNumber: v?.version_number };
      })
      .sort((a, b) => label(a).localeCompare(label(b)));
  }, [files.data, hashes.data, versions.data, projects.data]);

  const installedProjects = useMemo(() => new Set(items?.flatMap((i) => (i.project ? [i.project.id] : []))), [items]);
  const reload = useCallback(() => qc.invalidateQueries({ queryKey: ["content", instanceId, kind] }), [qc, instanceId, kind]);

  return {
    items,
    error: files.error,
    /** Still matching files against Modrinth; names fall back to file names meanwhile. */
    identifying: hashes.isFetching || versions.isFetching || projects.isFetching,
    installedProjects,
    reload,
  };
}

/** What to call a file: its Modrinth title, else the file name without extensions. */
export const label = (i: ContentItem) => i.project?.title ?? i.file.replace(/\.(jar|zip)(\.disabled)?$/, "");
