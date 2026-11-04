"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCrm } from "@/lib/store";
import type { Project } from "@/lib/types";

/** Resolve ?project=<id|KEY> to a project id ("pr-elang" or "ELG" both work). */
export function resolveProject(projects: Project[], raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  return projects.find((p) => p.id.toLowerCase() === v || p.key.toLowerCase() === v)?.id ?? null;
}

/** Writes a search param in place (replaceState keeps scroll and doesn't navigate). */
export function setUrlParam(name: string, value: string | null) {
  try {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(name, value);
    else url.searchParams.delete(name);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* non-browser */
  }
}

/**
 * Project selection backed by ?project=. `fallback` is used when the param is absent or unknown
 * ("all" on the board/issues list; the first project on the backlog).
 * `onExternal` fires when the param changes from outside (a link), with the resolved id.
 */
export function useProjectParam(fallback: string, onExternal?: (projectId: string) => void): [string, (id: string) => void] {
  const params = useSearchParams();
  const projects = useCrm((s) => s.projects);
  const raw = params.get("project");
  const resolved = resolveProject(projects, raw);
  const [projectId, setProjectId] = useState<string>(resolved ?? fallback);
  useEffect(() => {
    if (resolved) {
      setProjectId(resolved);
      onExternal?.(resolved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);
  const update = (id: string) => {
    setProjectId(id);
    setUrlParam("project", id === "all" ? null : id);
  };
  return [projectId, update];
}
