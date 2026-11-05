"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Handshake, Kanban, Menu, Phone, Plus, Search, User, X } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { Kbd } from "@/components/ui/misc";
import { Menu as DropMenu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/overlays";
import { ShellSkeleton } from "@/components/ui/skeletons";
import { ToastViewport } from "@/components/ui/toast";
import { ConfirmHost } from "@/components/ui/confirm";
import { NotificationBell } from "./notifications";
import { Sidebar } from "./sidebar";
import { COMPACT_QUERY, recordFromPath, useGlobalHotkeys, useMobileNav, useRecentTracker } from "./hotkeys";
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

  useRememberSidebar(hydrated);

  // the shell skeleton is server-rendered, so the layout is on screen before the bundle and local data are ready
  if (!hydrated) return <ShellSkeleton />;

  return (
    <div data-shell-root className="flex h-dvh overflow-hidden">
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
      <div data-shell-chrome className="hidden h-full shrink-0 lg:flex">
        <Suspense fallback={<div className="w-[232px] border-r border-sg-line" />}>
          <Sidebar />
        </Suspense>
      </div>
      {/* < lg: the same sidebar as an off-canvas drawer */}
      <Suspense fallback={null}>
        <MobileNavDrawer />
      </Suspense>
      <div data-shell-content className="flex min-w-0 flex-1 flex-col overflow-hidden">
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
  const openDialog = useUi((s) => s.openDialog);
  const pathname = usePathname();
  const target = recordFromPath(pathname);
  return (
    <div data-shell-chrome className="flex h-[calc(3rem+env(safe-area-inset-top))] shrink-0 items-center gap-1.5 border-b border-sg-line bg-sg-bg px-2 pt-[env(safe-area-inset-top)] lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={navOpen}
        aria-haspopup="dialog"
        className="flex size-10 items-center justify-center rounded text-sg-muted hover:bg-sg-card-2 hover:text-sg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70"
      >
        <Menu className="size-5" />
      </button>
      <Link href="/home" aria-label="Spectrum CRM home" className="flex min-w-0 items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/spectrum-logo.png" alt="Spectrum Group" width={104} height={20} className="h-5 w-auto" />
        <span className="hidden rounded-sm border border-sg-line-2 px-1 text-[9px] font-bold uppercase tracking-[0.14em] text-sg-muted min-[380px]:inline">CRM</span>
      </Link>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search (Command K)"
        className="ml-auto flex h-10 min-w-10 items-center justify-center gap-2 rounded border border-sg-line bg-sg-card px-2.5 text-sm text-sg-dim hover:border-sg-line-2 hover:text-sg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Search</span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </button>
      <DropMenu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label="Create"
            className="flex size-10 items-center justify-center rounded text-sg-muted hover:bg-sg-card-2 hover:text-sg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70"
          >
            <Plus className="size-5" />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuLabel>Create</MenuLabel>
          <MenuItem onSelect={() => openDialog({ kind: "createDeal", companyId: target?.type === "company" ? target.id : undefined })}>
            <Handshake className="size-4 text-soft-yellow" /> Deal
          </MenuItem>
          <MenuItem onSelect={() => openDialog({ kind: "createContact", companyId: target?.type === "company" ? target.id : undefined })}>
            <User className="size-4 text-soft-blue" /> Contact
          </MenuItem>
          <MenuItem onSelect={() => openDialog({ kind: "createIssue", link: target ? { crmType: target.type, crmId: target.id, linkType: target.type === "ticket" ? "escalated_from" : "relates_to" } : undefined })}>
            <Kanban className="size-4 text-soft-cyan" /> Issue{target ? " (linked)" : ""}
          </MenuItem>
          <MenuItem onSelect={() => openDialog({ kind: "logActivity", activityType: "call", target })}>
            <Phone className="size-4 text-soft-green" /> Log a call{target ? " here" : ""}
          </MenuItem>
        </MenuContent>
      </DropMenu>
      <div className="flex shrink-0 items-center [&>button]:size-10">
        <NotificationBell collapsed />
      </div>
    </div>
  );
}

/** Remember the desktop rail's collapsed state per viewer (local convenience only). */
const COLLAPSED_KEY = "sg-crm-sidebar-collapsed";
function useRememberSidebar(hydrated: boolean) {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const restored = useRef(false);
  useEffect(() => {
    if (!hydrated || restored.current) return;
    restored.current = true;
    try {
      if (window.localStorage.getItem(COLLAPSED_KEY) === "1" && !useUi.getState().sidebarCollapsed) useUi.getState().toggleSidebar();
    } catch {
      /* storage unavailable */
    }
  }, [hydrated]);
  useEffect(() => {
    // the mobile drawer temporarily expands the rail — don't remember that
    if (!restored.current || useMobileNav.getState().open) return;
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }, [collapsed]);
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
          <div className="flex h-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <Sidebar />
          </div>
          <DialogPrimitive.Close
            aria-label="Close navigation"
            className="absolute -right-12 top-[calc(0.5rem+env(safe-area-inset-top))] flex size-10 items-center justify-center rounded-full border border-sg-line-2 bg-sg-card-2 text-sg-white shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70"
          >
            <X className="size-5" />
          </DialogPrimitive.Close>
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
      <ConfirmHost />
      <ToastViewport />
    </>
  );
}
