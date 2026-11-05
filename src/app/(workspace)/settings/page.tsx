"use client";

/* Workspace settings — sync, identity & security, data, inventory, audit trail, version history, health and admin seeding. */
import { useMemo } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { AuditSection, HistorySection } from "./audit-section";
import { AdminSeedSection, DataSection, HealthSection, InventorySection, useHealth, useWorkspaceAdmin } from "./data-sections";
import { IdentitySection, SyncSection } from "./workspace-sections";

const NAV = [
  { id: "sync", label: "Workspace sync" },
  { id: "identity", label: "Identity & security" },
  { id: "data", label: "Data", admin: true },
  { id: "inventory", label: "Inventory" },
  { id: "audit", label: "Audit trail", admin: true },
  { id: "history", label: "Version history", admin: true },
  { id: "health", label: "System health" },
  { id: "admin", label: "Admin", admin: true },
];

export default function SettingsPage() {
  const admin = useWorkspaceAdmin();
  const health = useHealth();
  const nav = useMemo(() => NAV.filter((n) => admin || !n.admin), [admin]);
  return (
    <>
      <PageHeader title="Settings">
        <nav className="flex flex-wrap items-center gap-1" aria-label="Settings sections">
          {nav.map((n) => (
            <a key={n.id} href={`#${n.id}`} className="rounded px-2 py-1 text-xs font-semibold text-sg-muted hover:bg-sg-card hover:text-sg-white">
              {n.label}
            </a>
          ))}
        </nav>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-4 px-5 py-5">
          <SyncSection />
          <IdentitySection health={health} />
          <DataSection />
          <InventorySection />
          {admin && <AuditSection />}
          {admin && <HistorySection />}
          <HealthSection state={health} />
          <AdminSeedSection />
        </div>
      </div>
    </>
  );
}
