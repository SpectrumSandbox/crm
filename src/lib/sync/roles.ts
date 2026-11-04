/** Short labels for governance roles held on employee profiles (shown in the "acting as" switcher). */
const GOVERNANCE_LABELS: Record<string, string> = {
  prc: "PRC",
  ceo: "CEO",
  cfo: "CFO",
  hr: "HR",
  finance: "Finance",
  executive_committee: "ExCo",
};

export function governanceLabel(role: string): string {
  return GOVERNANCE_LABELS[role] ?? role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type ProfileLike = { userId: string; governanceRoles?: readonly string[] | null };

/** userId → governance role labels, tolerant of profiles without the field. */
export function governanceByUser(profiles: readonly unknown[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const p of profiles as readonly ProfileLike[]) {
    const roles = Array.isArray(p?.governanceRoles) ? p.governanceRoles : [];
    if (p?.userId && roles.length) map.set(p.userId, roles.map(governanceLabel));
  }
  return map;
}
