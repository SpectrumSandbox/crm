import { AppShell } from "@/components/shell/app-shell";

// The workspace is interactive client state on top of D1; render per request rather than prerendering.
export const dynamic = "force-dynamic";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
