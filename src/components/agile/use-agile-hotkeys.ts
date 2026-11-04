"use client";

import { useEffect, useRef } from "react";
import { useUi } from "@/lib/store";

export function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** True when a modal, sheet, menu, popover or listbox is open anywhere on the page. */
export function overlayOpen() {
  const ui = useUi.getState();
  if (ui.dialog || ui.paletteOpen || ui.issueId) return true;
  return !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
}

/**
 * Page-level hotkeys for the agile pages. Runs in the capture phase so it can take keys
 * before the global handler (e.g. "C" creates an issue in the selected project, "l" moves
 * board focus instead of logging a call). Return true from a handler to consume the key.
 * A key pressed within 900 ms of "g" is left alone so G-sequences keep navigating.
 */
export function useAgileHotkeys(handler: (e: KeyboardEvent) => boolean) {
  const ref = useRef(handler);
  ref.current = handler;
  const lastG = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || overlayOpen()) return;
      if (e.key === "g" || e.key === "G") {
        lastG.current = Date.now();
        return;
      }
      if (Date.now() - (lastG.current ?? 0) < 900) {
        lastG.current = 0;
        return;
      }
      if (ref.current?.(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

/** "C" on an agile page opens Create issue preset to the page's project. */
export function createIssueKey(e: KeyboardEvent, projectId: string | undefined) {
  if (e.key !== "c" && e.key !== "C") return false;
  useUi.getState().openDialog({ kind: "createIssue", projectId });
  return true;
}
