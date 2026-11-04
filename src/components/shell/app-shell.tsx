"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Menu, Search } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { Kbd, SpectrumRule } from "@/components/ui/misc";
import { Sidebar } from "./sidebar";
import { COMPACT_QUERY, useGlobalHotkeys, useMobileNav, useRecentTracker } from "./hotkeys";
import { WorkspaceSync } from "./sync";

/* Heavy overlays are split into their own chunks and mounted after first paint (or the moment they're needed). */
const loadPalette = () => import("./command-palette");
const loadDialogs = () => import("./dialogs");
const loadIssueDrawer = () => import("@/components/agile/issue-drawer");

const CommandPalette = dynamic(() => loadPalette().then((m) => m.CommandPalette), { ssr: false, loading: () => null });
const GlobalDialogs = dynamic(() => loadDialogs().then((m) => m.GlobalDialogs), { ssr: false, loading: () => null });
const IssueDrawer = dynamic(() => loadIssueDrawer().then((m) => m.IssueDrawer), { ssr: false, loading: () => null });

function preloadOverlays() {
  void loadPalette();
  void loadDialogs();
  void loadIssueDrawer();
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // localStorage-backed demo state is restored only on the client to keep SSR markup deterministic
    const done = () => setHydrated(true);
    const unsub = useCrm.persist.onFinishHydration(done);
    void useCrm.persist.rehydrate();
    if (useCrm.persist.hasHydrated()) done();
    return unsub;
  }, []);

  if (!hydrated) return <BootScreen />;

  return (
    <div className="flex h-dvh overflow-hidden">
      <a
        href="#main"
        onClick={(e) => {
          const main = document.getElementById("main");
          if (!main) return;
          e.preventDefault();
          main.focus();
          main.scrollIntoView({ block: "start" });
        }}
        className="sr-only z-[80] rounded bg-sg-white px-3 py-2 text-sm font-semibold text-sg-bg shadow-pop focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:outline-none focus:ring-2 focus:ring-sg-white/70 focus:ring-offset-2 focus:ring-offset-sg-bg"
      >
        Skip to content
      </a>
      {/* desktop rail */}
      <div className="hidden h-full shrink-0 lg:flex">
        <Suspense fallback={<div className="w-[232px] border-r border-sg-line" />}>
          <Sidebar />
        </Suspense>
      </div>
      {/* < lg: the same sidebar as an off-canvas drawer */}
      <Suspense fallback={null}>
        <MobileNavDrawer />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MobileTopBar />
        <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col overflow-hidden focus:outline-none">
          <Suspense fallback={null}>{children}</Suspense>
        </main>
      </div>
      <Suspense fallback={null}>
        <Overlays />
      </Suspense>
    </div>
  );
}

/* ───────────── Mobile / tablet navigation ───────────── */

function MobileTopBar() {
  const setOpen = useMobileNav((s) => s.setOpen);
  const navOpen = useMobileNav((s) => s.open);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-sg-line bg-sg-bg px-2 lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={navOpen}
        aria-haspopup="dialog"
        className="flex size-9 items-center justify-center rounded text-sg-muted hover:bg-sg-card-2 hover:text-sg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70"
      >
        <Menu className="size-5" />
      </button>
      <Link href="/home" aria-label="Spectrum CRM home" className="flex items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/spectrum-logo.png" alt="Spectrum Group" width={104} height={20} className="h-5 w-auto" />
        <span className="rounded-sm border border-sg-line-2 px-1 text-[9px] font-bold uppercase tracking-[0.14em] text-sg-muted">CRM</span>
      </Link>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search (Command K)"
        className="ml-auto flex h-9 items-center gap-2 rounded border border-sg-line bg-sg-card px-2.5 text-sm text-sg-dim hover:border-sg-line-2 hover:text-sg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Search</span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </button>
    </div>
  );
}

function MobileNavDrawer() {
  const open = useMobileNav((s) => s.open);
  const setOpen = useMobileNav((s) => s.setOpen);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const restoreCollapsed = useRef(false);

  // close on navigation (pathname or ?view= change)
  useEffect(() => {
    useMobileNav.getState().setOpen(false);
  }, [pathname, search]);

  // close if the viewport grows to desktop width while open
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(COMPACT_QUERY);
    const onChange = () => {
      if (!mq.matches) useMobileNav.getState().setOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // the drawer always shows the full-width sidebar; put the desktop rail back the way it was on close
  useEffect(() => {
    if (open && collapsed) {
      restoreCollapsed.current = true;
      toggleSidebar();
    } else if (!open && restoreCollapsed.current) {
      restoreCollapsed.current = false;
      if (!useUi.getState().sidebarCollapsed) toggleSidebar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 lg:hidden" />
        <DialogPrimitive.Content
          id="mobile-nav"
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-40 flex max-w-[85vw] shadow-pop focus:outline-none data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left-full data-[state=open]:animate-in data-[state=open]:slide-in-from-left-full lg:hidden"
        >
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <Sidebar />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ───────────── Overlays (lazy) ───────────── */

function useOverlaysReady() {
  // mount immediately if something asks for an overlay before the idle preload finished (e.g. ⌘K on first paint)
  const wanted = useUi((s) => s.paletteOpen || s.dialog !== null || s.issueId !== null);
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const run = () => {
      preloadOverlays();
      setIdle(true);
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(run, 300);
    return () => window.clearTimeout(t);
  }, []);
  return idle || wanted;
}

function Overlays() {
  useGlobalHotkeys();
  useRecentTracker();
  const ready = useOverlaysReady();
  return (
    <>
      <WorkspaceSync />
      {ready ? (
        <>
          <CommandPalette />
          <GlobalDialogs />
          <IssueDrawer />
        </>
      ) : null}
      <Toast />
    </>
  );
}

function BootScreen() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4" role="status" aria-label="Loading workspace">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/spectrum-logo.png" alt="Spectrum Group" width={160} height={31} className="h-[31px] w-auto opacity-90" />
      <SpectrumRule className="w-40 animate-pulse" />
    </div>
  );
}

function Toast() {
  const toast = useUi((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), toast.action ? 6000 : 2400);
    return () => window.clearTimeout(t);
  }, [toast]);
  if (!toast || !visible) return null;
  return (
    <div role="status" className="fixed bottom-5 left-1/2 z-[70] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-pill border border-sg-line-2 bg-sg-card-2 px-4 py-2 text-sm font-semibold text-sg-white shadow-pop animate-in fade-in-0 slide-in-from-bottom-2">
      <Check className="size-4 shrink-0 text-soft-green" aria-hidden />
      <span className="min-w-0 truncate">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.run();
            setVisible(false);
          }}
          className="ml-1 shrink-0 rounded-pill border border-sg-line-2 px-2 py-0.5 text-xs text-sg-white hover:bg-sg-white hover:text-sg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
