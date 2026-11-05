/* Template personalisation for email + WhatsApp templates, sequences and workflow actions (W10).
 * Same token syntax as the log-email dialog ({{contact.first_name}}), extended with a few more fields. Pure — no React. */
import type { Company, Contact, CrmObjectType, Deal, EmailTemplate, Ticket, User } from "@/lib/types";
import { formatDate, formatIDR } from "@/lib/utils";

export const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export const TOKENS: { token: string; label: string; group: "Contact" | "Company" | "Deal" | "Owner" | "Ticket" }[] = [
  { token: "contact.first_name", label: "First name", group: "Contact" },
  { token: "contact.last_name", label: "Last name", group: "Contact" },
  { token: "contact.full_name", label: "Full name", group: "Contact" },
  { token: "contact.job_title", label: "Job title", group: "Contact" },
  { token: "company.name", label: "Company", group: "Company" },
  { token: "company.city", label: "City", group: "Company" },
  { token: "deal.name", label: "Deal name", group: "Deal" },
  { token: "deal.capability", label: "Capability", group: "Deal" },
  { token: "deal.amount", label: "Amount", group: "Deal" },
  { token: "deal.close_date", label: "Close date", group: "Deal" },
  { token: "owner.first_name", label: "Owner first name", group: "Owner" },
  { token: "owner.name", label: "Owner name", group: "Owner" },
  { token: "owner.title", label: "Owner title", group: "Owner" },
  { token: "owner.email", label: "Owner email", group: "Owner" },
  { token: "owner.meeting_link", label: "Meeting link", group: "Owner" },
  { token: "ticket.id", label: "Ticket number", group: "Ticket" },
  { token: "ticket.subject", label: "Ticket subject", group: "Ticket" },
];

export interface TokenContext {
  contact?: Contact;
  company?: Company;
  deal?: Deal;
  ticket?: Ticket;
  owner?: User;
}

interface TokenData {
  contacts: Contact[];
  companies: Company[];
  deals: Deal[];
  tickets: Ticket[];
  users: User[];
  pipelines: { stages: { id: string; closed?: "won" | "lost" }[] }[];
}

/** contact / company / deal / ticket / owner as seen from a CRM record (the contact wins when given explicitly) */
export function tokenContext(data: TokenData, target: { type: CrmObjectType; id: string } | null, contactId?: string | null): TokenContext {
  const closed = new Set(data.pipelines.flatMap((p) => p.stages).filter((s) => s.closed).map((s) => s.id));
  const openDealFor = (pred: (d: Deal) => boolean) => {
    const all = data.deals.filter(pred).sort((a, b) => a.closeDate.localeCompare(b.closeDate));
    return all.find((d) => !closed.has(d.stageId)) ?? all[0];
  };
  let contact = contactId ? data.contacts.find((c) => c.id === contactId) : undefined;
  let company: Company | undefined;
  let deal: Deal | undefined;
  let ticket: Ticket | undefined;
  let ownerId: string | undefined;
  if (target?.type === "deal") {
    deal = data.deals.find((d) => d.id === target.id);
    contact = contact ?? data.contacts.find((c) => c.id === deal?.contactIds[0]);
    company = data.companies.find((c) => c.id === deal?.companyId);
    ownerId = deal?.ownerId;
  } else if (target?.type === "ticket") {
    ticket = data.tickets.find((t) => t.id === target.id);
    contact = contact ?? data.contacts.find((c) => c.id === ticket?.contactId);
    company = data.companies.find((c) => c.id === ticket?.companyId);
    ownerId = ticket?.ownerId;
  } else if (target?.type === "company") {
    company = data.companies.find((c) => c.id === target.id);
    contact = contact ?? data.contacts.filter((c) => c.companyId === target.id).sort((a, b) => b.leadScore - a.leadScore)[0];
    deal = openDealFor((d) => d.companyId === target.id);
    ownerId = company?.ownerId;
  } else if (target?.type === "contact") {
    contact = data.contacts.find((c) => c.id === target.id);
  }
  if (contact && !company) company = data.companies.find((c) => c.id === contact!.companyId);
  if (contact && !deal) deal = openDealFor((d) => d.contactIds.includes(contact!.id));
  ownerId = ownerId ?? contact?.ownerId;
  return { contact, company, deal, ticket, owner: data.users.find((u) => u.id === ownerId) };
}

export function tokenValue(token: string, ctx: TokenContext): string | undefined {
  switch (token) {
    case "contact.first_name":
      return ctx.contact?.firstName || undefined;
    case "contact.last_name":
      return ctx.contact?.lastName || undefined;
    case "contact.full_name":
      return ctx.contact ? `${ctx.contact.firstName} ${ctx.contact.lastName}`.trim() : undefined;
    case "contact.job_title":
      return ctx.contact?.jobTitle || undefined;
    case "company.name":
      return ctx.company?.name || undefined;
    case "company.city":
      return ctx.company?.city || undefined;
    case "deal.name":
      return ctx.deal?.name || undefined;
    case "deal.capability":
      return ctx.deal?.capability || undefined;
    case "deal.amount":
      return ctx.deal ? formatIDR(ctx.deal.amount, "full") : undefined;
    case "deal.close_date":
      return ctx.deal ? formatDate(ctx.deal.closeDate) : undefined;
    case "owner.first_name":
      return ctx.owner?.name.split(" ")[0] || undefined;
    case "owner.name":
      return ctx.owner?.name || undefined;
    case "owner.title":
      return ctx.owner?.title || undefined;
    case "owner.email":
      return ctx.owner?.email || undefined;
    case "owner.meeting_link":
      return ctx.owner ? `https://crm.spectrumgroup.id/meet/${ctx.owner.id}` : undefined;
    case "ticket.id":
      return ctx.ticket?.id.toUpperCase() || undefined;
    case "ticket.subject":
      return ctx.ticket?.subject || undefined;
    default:
      return undefined;
  }
}

/** Replace every resolvable token; unresolved ones stay visible as {{token}}. Extra values (e.g. workflow fields) win. */
export function renderTemplate(text: string, ctx: TokenContext, extra?: Record<string, string>) {
  return text.replace(TOKEN_RE, (whole, token: string) => extra?.[token] ?? tokenValue(token, ctx) ?? whole);
}

/** tokens left unresolved after rendering (or every unknown token when no context is given) */
export function unresolvedTokens(texts: string[], ctx?: TokenContext, extra?: Record<string, string>) {
  const known = new Set(TOKENS.map((t) => t.token));
  const out = new Set<string>();
  texts.forEach((t) => {
    for (const m of t.matchAll(TOKEN_RE)) {
      const tok = m[1];
      if (extra?.[tok] !== undefined) continue;
      if (ctx ? tokenValue(tok, ctx) === undefined : !known.has(tok)) out.add(tok);
    }
  });
  return Array.from(out);
}

export function unknownTokens(texts: string[]) {
  return unresolvedTokens(texts);
}

/* ───────────── WhatsApp click-to-chat ───────────── */

/** Indonesian numbers → wa.me digits: "0812-3456 7890" / "+62 812…" / "62812…" / "812…" → "62812…". null when unusable. */
export function waNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = `62${d.slice(1)}`;
  else if (d.startsWith("8")) d = `62${d}`;
  d = d.replace(/\D/g, "");
  return d.length >= 10 && d.length <= 15 ? d : null;
}

/** Mobile numbers only (Indonesian mobiles start 628…); landlines can't receive WhatsApp. */
export function isLikelyMobile(phone: string | null | undefined) {
  const n = waNumber(phone);
  return !!n && (!n.startsWith("62") || n.startsWith("628"));
}

export function waLink(phone: string | null | undefined, text: string) {
  const n = waNumber(phone);
  if (!n) return null;
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export const templateChannelOf = (t: Pick<EmailTemplate, "templateChannel">) => t.templateChannel ?? "email";
export const templateLanguageOf = (t: Pick<EmailTemplate, "templateLanguage">) => t.templateLanguage ?? "en";

/** WhatsApp practical limits: a message over ~1,000 characters is hard to read on a phone; 4,096 is the hard cap. */
export const WA_SOFT_LIMIT = 1000;
export const WA_HARD_LIMIT = 4096;
