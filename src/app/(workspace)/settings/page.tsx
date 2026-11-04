"use client";

/* Workspace settings — sync, identity, data backup, system health and admin seeding (platform workstream). */
import { PageHeader } from "@/components/shell/page-header";
import { AdminSeedSection, DataSection, HealthSection } from "./data-sections";
import { IdentitySection, SyncSection } from "./workspace-sections";

const NAV = [
  { id: "sync", label: "Workspace sync" },
  { id: "identity", label: "Identity" },
  { id: "data", label: "Data" },
  { id: "health", label: "System health" },
  { id: "admin", label: "Admin" },
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings">
        <nav className="flex flex-wrap items-center gap-1">
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`} className="rounded px-2 py-1 text-xs font-semibold text-sg-muted hover:bg-sg-card hover:text-sg-white">
              {n.label}
            </a>
          ))}
        </nav>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-4 px-5 py-5">
          <SyncSection />
          <IdentitySection />
          <DataSection />
          <HealthSection />
          <AdminSeedSection />
        </div>
      </div>
    </>
  );
}
