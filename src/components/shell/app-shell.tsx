"use client";

import { Suspense, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { SpectrumRule } from "@/components/ui/misc";
import { Sidebar } from "./sidebar";
import { CommandPalette } from "./command-palette";
import { GlobalDialogs } from "./dialogs";
import { useGlobalHotkeys } from "./hotkeys";
import { IssueDrawer } from "@/components/agile/issue-drawer";

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
      <Suspense fallback={<div className="w-[232px] border-r border-sg-line" />}>
        <Sidebar />
      </Suspense>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Suspense fallback={null}>{children}</Suspense>
      </main>
      <Suspense fallback={null}>
        <Overlays />
      </Suspense>
    </div>
  );
}

function Overlays() {
  useGlobalHotkeys();
  return (
    <>
      <CommandPalette />
      <GlobalDialogs />
      <IssueDrawer />
      <Toast />
    </>
  );
}

function BootScreen() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4">
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
    const t = window.setTimeout(() => setVisible(false), 2400);
    return () => window.clearTimeout(t);
  }, [toast]);
  if (!toast || !visible) return null;
  return (
    <div role="status" className="fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-pill border border-sg-line-2 bg-sg-card-2 px-4 py-2 text-sm font-semibold text-sg-white shadow-pop animate-in fade-in-0 slide-in-from-bottom-2">
      <Check className="size-4 text-soft-green" />
      {toast.message}
    </div>
  );
}
