-- Project Initiative and Compensation Policy v4.0 (docs/policy/v4.0.md).
-- Regressive revenue-share curve, UMKM tax, Team Allocation Ledger (allocation factor, work periods),
-- cash-based cumulative cycle with break-even test + cash check, Type C guaranteed minimum, §6.8 amendments.
ALTER TABLE `employee_profiles` ADD `contracted_hours_pct` integer;
ALTER TABLE `employee_profiles` ADD `contract_end_date` text;

ALTER TABLE `initiatives` ADD `origination` text;
ALTER TABLE `initiatives` ADD `first_contact_at` text;
ALTER TABLE `initiatives` ADD `unusual_terms` integer DEFAULT false NOT NULL;
ALTER TABLE `initiatives` ADD `deferral_pct` real;
ALTER TABLE `initiatives` ADD `policy_version` text DEFAULT '4.0' NOT NULL;
ALTER TABLE `initiatives` ADD `standard_bonus` integer;
ALTER TABLE `initiatives` ADD `pilot` integer DEFAULT false NOT NULL;
ALTER TABLE `initiatives` ADD `jira_project_id` text;
ALTER TABLE `initiatives` ADD `demo` integer DEFAULT false NOT NULL;
ALTER TABLE `initiatives` ADD `registered_retroactively` integer DEFAULT false NOT NULL;
ALTER TABLE `initiatives` ADD `share_note` text DEFAULT '' NOT NULL;
ALTER TABLE `initiatives` DROP COLUMN `cap_exception`;

ALTER TABLE `initiative_members` ADD `allocation_factor` real DEFAULT 1 NOT NULL;
ALTER TABLE `initiative_members` ADD `weight_note` text DEFAULT '' NOT NULL;
ALTER TABLE `initiative_members` ADD `authority` text DEFAULT '' NOT NULL;

ALTER TABLE `revenue_entries` ADD `collected_at` text;
ALTER TABLE `revenue_entries` ADD `work_period_start` text;
ALTER TABLE `revenue_entries` ADD `work_period_end` text;

ALTER TABLE `bonus_runs` ADD `policy_version` text DEFAULT '4.0' NOT NULL;
ALTER TABLE `bonus_runs` ADD `company_revenue` integer DEFAULT 0 NOT NULL;
ALTER TABLE `bonus_runs` ADD `direct_costs` integer DEFAULT 0 NOT NULL;
ALTER TABLE `bonus_runs` ADD `cash` integer DEFAULT 0 NOT NULL;
ALTER TABLE `bonus_runs` ADD `fixed_costs_monthly` integer DEFAULT 0 NOT NULL;
ALTER TABLE `bonus_runs` ADD `cash_after` real DEFAULT 0 NOT NULL;
ALTER TABLE `bonus_runs` ADD `payout_pct` real DEFAULT 1 NOT NULL;
ALTER TABLE `bonus_runs` DROP COLUMN `ebitda`;
ALTER TABLE `bonus_runs` DROP COLUMN `share_overrides`;
ALTER TABLE `bonus_runs` DROP COLUMN `partial_deferral_pct`;

ALTER TABLE `bonus_lines` ADD `weight_days` real DEFAULT 0 NOT NULL;
ALTER TABLE `bonus_lines` ADD `total_weight_days` real DEFAULT 0 NOT NULL;
ALTER TABLE `bonus_lines` ADD `top_up` real DEFAULT 0 NOT NULL;
ALTER TABLE `bonus_lines` ADD `top_up_deducted` real DEFAULT 0 NOT NULL;
ALTER TABLE `bonus_lines` ADD `guaranteed` real DEFAULT 0 NOT NULL;
ALTER TABLE `bonus_lines` ADD `carried_in` real DEFAULT 0 NOT NULL;

ALTER TABLE `clawbacks` ADD `written_agreement` integer DEFAULT false NOT NULL;

DROP TABLE IF EXISTS `share_adjustments`;
CREATE TABLE `curve_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`from_curve` text NOT NULL,
	`to_curve` text NOT NULL,
	`proposed_at` text NOT NULL,
	`effective_from` text NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`approved_by_id` text NOT NULL REFERENCES `users`(`id`)
);
CREATE INDEX `curve_adjustments_effective_idx` ON `curve_adjustments` (`effective_from`);

CREATE TABLE `team_amendments` (
	`id` text PRIMARY KEY NOT NULL,
	`initiative_id` text NOT NULL REFERENCES `initiatives`(`id`) ON DELETE cascade,
	`proposed_by_id` text NOT NULL REFERENCES `users`(`id`),
	`circulated_at` text NOT NULL,
	`effective_date` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`change` text NOT NULL,
	`votes` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`prc_decision` text,
	`recorded_at` text
);
CREATE INDEX `team_amendments_initiative_idx` ON `team_amendments` (`initiative_id`,`status`);
