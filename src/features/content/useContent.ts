import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { launcher } from "@/api/launcher";
import { sources, type ProjectSummary } from "@/api/sources";
import { useSource } from "@/hooks/useSource";
import type { ContentKind, ModFile } from "@/types";

export interface ContentItem extends ModFile {
  /** Set when the content source recognises the file by its hash. */
  project?: ProjectSummary;
  versionNumber?: string;
}

/**
 * Files of one kind in an instance, enriched with their project on the content source.
 * The backend hashes the files and asks the source; cached on the file list's names and sizes.
 */
export function useContent(instanceId: string, kind: ContentKind, identify = true) {
  const qc = useQueryClient();
  const source = useSource()?.id;
  const files = useQuery({ queryKey: ["content", instanceId, kind], queryFn: () => launcher.listContent(instanceId, kind) });

  const signature = files.data?.map((f) => `${f.file}:${f.size}`).join("|") ?? "";
  const known = useQuery({
    queryKey: ["content-identify", source, instanceId, kind, signature],
    queryFn: () => sources.identifyContent(source!, instanceId, kind),
    enabled: identify && !!source && !!files.data?.length,
    staleTime: Infinity,
  });

  const items = useMemo<ContentItem[] | undefined>(() => {
    if (!files.data) return undefined;
    return files.data
      .map((f) => {
        const k = known.data?.[f.file];
        return { ...f, project: k?.project, versionNumber: k?.versionNumber };
      })
      .sort((a, b) => label(a).localeCompare(label(b)));
  }, [files.data, known.data]);

  const installedProjects = useMemo(() => new Set(items?.flatMap((i) => (i.project ? [i.project.id] : []))), [items]);
  const reload = useCallback(() => qc.invalidateQueries({ queryKey: ["content", instanceId, kind] }), [qc, instanceId, kind]);

  return {
    items,
    error: files.error,
    /** Still matching files against the source; names fall back to file names meanwhile. */
    identifying: known.isFetching,
    installedProjects,
    reload,
  };
}

/** What to call a file: its project title, else the file name without extensions. */
export const label = (i: ContentItem) => i.project?.title ?? i.file.replace(/\.(jar|zip)(\.disabled)?$/, "");
