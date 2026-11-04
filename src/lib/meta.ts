/* Display metadata for enums — labels, colours, icons — shared across views. */
import {
  Banknote,
  Bug,
  CalendarDays,
  SquareCheck,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  Equal,
  Headset,
  Lightbulb,
  ListTree,
  Mail,
  Phone,
  StickyNote,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type {
  ActivityType,
  IssuePriority,
  IssueStatus,
  IssueType,
  LeadStatus,
  LifecycleStage,
  LinkType,
  QuoteStatus,
  SpectrumColor,
  TicketPriority,
} from "./types";

export const lifecycleMeta: Record<LifecycleStage, { label: string; color: SpectrumColor }> = {
  subscriber: { label: "Subscriber", color: "blue" },
  lead: { label: "Lead", color: "cyan" },
  mql: { label: "MQL", color: "magenta" },
  sql: { label: "SQL", color: "yellow" },
  opportunity: { label: "Opportunity", color: "orange" },
  customer: { label: "Customer", color: "green" },
  evangelist: { label: "Evangelist", color: "red" },
};

export const leadStatusMeta: Record<LeadStatus, string> = {
  new: "New",
  open: "Open",
  in_progress: "In progress",
  connected: "Connected",
  unqualified: "Unqualified",
  bad_timing: "Bad timing",
};

export const issueTypeMeta: Record<IssueType, { label: string; icon: LucideIcon; color: SpectrumColor }> = {
  story: { label: "Story", icon: Lightbulb, color: "green" },
  task: { label: "Task", icon: SquareCheck, color: "blue" },
  bug: { label: "Bug", icon: Bug, color: "red" },
  deal_action: { label: "Deal Action", icon: Banknote, color: "yellow" },
  support_escalation: { label: "Support Escalation", icon: Headset, color: "orange" },
  subtask: { label: "Sub-task", icon: ListTree, color: "cyan" },
};

export const issueStatusMeta: Record<IssueStatus, { label: string; color: SpectrumColor }> = {
  backlog: { label: "Backlog", color: "blue" },
  todo: { label: "To Do", color: "magenta" },
  in_progress: { label: "In Progress", color: "cyan" },
  in_review: { label: "In Review", color: "yellow" },
  done: { label: "Done", color: "green" },
};

export const priorityMeta: Record<IssuePriority, { label: string; icon: LucideIcon; color: SpectrumColor; weight: number }> = {
  highest: { label: "Highest", icon: ChevronsUp, color: "red", weight: 5 },
  high: { label: "High", icon: ChevronUp, color: "orange", weight: 4 },
  medium: { label: "Medium", icon: Equal, color: "yellow", weight: 3 },
  low: { label: "Low", icon: ChevronDown, color: "blue", weight: 2 },
  lowest: { label: "Lowest", icon: ChevronsDown, color: "cyan", weight: 1 },
};

export const ticketPriorityMeta: Record<TicketPriority, { label: string; color: SpectrumColor }> = {
  urgent: { label: "Urgent", color: "red" },
  high: { label: "High", color: "orange" },
  medium: { label: "Medium", color: "yellow" },
  low: { label: "Low", color: "blue" },
};

export const activityMeta: Record<ActivityType, { label: string; plural: string; icon: LucideIcon; color: SpectrumColor }> = {
  note: { label: "Note", plural: "Notes", icon: StickyNote, color: "yellow" },
  email: { label: "Email", plural: "Emails", icon: Mail, color: "blue" },
  call: { label: "Call", plural: "Calls", icon: Phone, color: "green" },
  meeting: { label: "Meeting", plural: "Meetings", icon: CalendarDays, color: "magenta" },
  task: { label: "Task", plural: "Tasks", icon: SquareCheck, color: "orange" },
  jira: { label: "Jira update", plural: "Jira Updates", icon: Workflow, color: "cyan" },
};

/** link types read from the Jira side → phrase as seen from the CRM side */
export const linkTypeMeta: Record<LinkType, { label: string; crmSide: string; color: SpectrumColor }> = {
  blocks: { label: "blocks", crmSide: "blocked by", color: "red" },
  blocked_by: { label: "is blocked by", crmSide: "blocks", color: "orange" },
  relates_to: { label: "relates to", crmSide: "relates to", color: "blue" },
  escalated_from: { label: "escalated from", crmSide: "escalated to", color: "orange" },
  implements: { label: "implements", crmSide: "implemented by", color: "green" },
};

export const quoteStatusMeta: Record<QuoteStatus, { label: string; color: SpectrumColor }> = {
  draft: { label: "Draft", color: "blue" },
  pending_approval: { label: "Pending approval", color: "yellow" },
  approved: { label: "Approved", color: "cyan" },
  sent: { label: "Sent", color: "magenta" },
  signed: { label: "Signed", color: "green" },
  expired: { label: "Expired", color: "red" },
};

export const callOutcomeLabel: Record<string, string> = {
  connected: "Connected",
  left_voicemail: "Left voicemail",
  no_answer: "No answer",
  busy: "Busy",
  wrong_number: "Wrong number",
};
