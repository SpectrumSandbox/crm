-- Project Initiative & Compensation Policy v3.0 (matches src/db/schema.ts)
CREATE TABLE `employee_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`employment_type` text NOT NULL,
	`hire_date` text NOT NULL,
	`probation_end_date` text,
	`annual_base_salary` integer DEFAULT 0 NOT NULL,
	`direct_manager_id` text,
	`good_standing` integer DEFAULT true NOT NULL,
	`active_written_warning` integer DEFAULT false NOT NULL,
	`on_pip` integer DEFAULT false NOT NULL,
	`pip_approved_by_prc` integer DEFAULT false NOT NULL,
	`under_investigation` integer DEFAULT false NOT NULL,
	`suspended` integer DEFAULT false NOT NULL,
	`unpaid_leave_days` integer DEFAULT 0 NOT NULL,
	`resignation_notice_at` text,
	`termination_notice_at` text,
	`separation` text,
	`acknowledgment_signed_at` text,
	`governance_roles` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`direct_manager_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `employee_profiles_manager_idx` ON `employee_profiles` (`direct_manager_id`);
--> statement-breakpoint
CREATE TABLE `initiatives` (
	`id` text PRIMARY KEY NOT NULL,
	`tracking_no` text DEFAULT '' NOT NULL,
	`code` text,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`initiator_id` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`value_proposition` text DEFAULT '' NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`deliverables` text DEFAULT '' NOT NULL,
	`exclusions` text DEFAULT '' NOT NULL,
	`success_criteria` text DEFAULT '' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`milestones` text DEFAULT '[]' NOT NULL,
	`company_id` text,
	`deal_id` text,
	`contract_status` text DEFAULT 'none' NOT NULL,
	`new_client` integer DEFAULT false NOT NULL,
	`payment_terms_days` integer DEFAULT 30 NOT NULL,
	`revenue` text NOT NULL,
	`costs` text NOT NULL,
	`risks` text DEFAULT '[]' NOT NULL,
	`high_risk` integer DEFAULT false NOT NULL,
	`warranty` integer DEFAULT false NOT NULL,
	`deferral_months` integer DEFAULT 6 NOT NULL,
	`locked_share_pct` real,
	`cap_exception` integer DEFAULT false NOT NULL,
	`submitted_at` text,
	`acknowledged_at` text,
	`primary_reviewer_id` text,
	`scores` text,
	`decision` text,
	`appeal` text,
	`approved_at` text,
	`completed_at` text,
	`epic_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`initiator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`primary_reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`epic_id`) REFERENCES `epics`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `initiatives_code_uq` ON `initiatives` (`code`);
--> statement-breakpoint
CREATE INDEX `initiatives_status_idx` ON `initiatives` (`status`);
--> statement-breakpoint
CREATE INDEX `initiatives_tracking_idx` ON `initiatives` (`tracking_no`);
--> statement-breakpoint
CREATE INDEX `initiatives_initiator_idx` ON `initiatives` (`initiator_id`);
--> statement-breakpoint
CREATE INDEX `initiatives_company_idx` ON `initiatives` (`company_id`);
--> statement-breakpoint
CREATE INDEX `initiatives_deal_idx` ON `initiatives` (`deal_id`);
--> statement-breakpoint
CREATE TABLE `initiative_members` (
	`id` text PRIMARY KEY NOT NULL,
	`initiative_id` text NOT NULL,
	`user_id` text NOT NULL,
	`roles` text DEFAULT '[]' NOT NULL,
	`specialist_weight` real,
	`weight_override` real,
	`consent` text DEFAULT 'pending' NOT NULL,
	`manager_approved` integer DEFAULT false NOT NULL,
	`prc_approved` integer DEFAULT false NOT NULL,
	`application` integer DEFAULT false NOT NULL,
	`allocation_pct` real DEFAULT 20 NOT NULL,
	`joined_at` text NOT NULL,
	`left_at` text,
	`removal` text NOT NULL,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiatives`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `initiative_members_initiative_idx` ON `initiative_members` (`initiative_id`);
--> statement-breakpoint
CREATE INDEX `initiative_members_user_idx` ON `initiative_members` (`user_id`);
--> statement-breakpoint
CREATE TABLE `revenue_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`initiative_id` text NOT NULL,
	`month` text NOT NULL,
	`revenue` integer DEFAULT 0 NOT NULL,
	`direct_costs` integer DEFAULT 0 NOT NULL,
	`basis` text NOT NULL,
	`received` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiatives`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `revenue_entries_initiative_idx` ON `revenue_entries` (`initiative_id`,`month`);
--> statement-breakpoint
CREATE INDEX `revenue_entries_month_idx` ON `revenue_entries` (`month`);
--> statement-breakpoint
CREATE TABLE `bonus_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`status` text NOT NULL,
	`overheads` integer DEFAULT 0 NOT NULL,
	`ebitda` integer DEFAULT 0 NOT NULL,
	`share_overrides` text DEFAULT '{}' NOT NULL,
	`partial_deferral_pct` real DEFAULT 0 NOT NULL,
	`operating_result` real NOT NULL,
	`totals` text NOT NULL,
	`certified_by_id` text,
	`certified_at` text,
	`released_by_id` text,
	`released_at` text,
	FOREIGN KEY (`certified_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`released_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bonus_runs_month_uq` ON `bonus_runs` (`month`);
--> statement-breakpoint
CREATE TABLE `bonus_lines` (
	`run_id` text NOT NULL,
	`initiative_id` text NOT NULL,
	`user_id` text NOT NULL,
	`weight` real NOT NULL,
	`total_weight` real NOT NULL,
	`share_pct` real NOT NULL,
	`net_revenue` real NOT NULL,
	`pool` real NOT NULL,
	`gross` real NOT NULL,
	`payable` real DEFAULT 0 NOT NULL,
	`deferred` real DEFAULT 0 NOT NULL,
	`carried_over` real DEFAULT 0 NOT NULL,
	`withheld` real DEFAULT 0 NOT NULL,
	`forfeited` real DEFAULT 0 NOT NULL,
	`held` real DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`notes` text DEFAULT '[]' NOT NULL,
	PRIMARY KEY(`run_id`, `initiative_id`, `user_id`),
	FOREIGN KEY (`run_id`) REFERENCES `bonus_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiatives`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bonus_lines_user_idx` ON `bonus_lines` (`user_id`);
--> statement-breakpoint
CREATE INDEX `bonus_lines_initiative_idx` ON `bonus_lines` (`initiative_id`);
--> statement-breakpoint
CREATE TABLE `deferred_bonuses` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`initiative_id` text NOT NULL,
	`user_id` text NOT NULL,
	`amount` real NOT NULL,
	`vest_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`released_amount` real DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiatives`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deferred_bonuses_user_idx` ON `deferred_bonuses` (`user_id`);
--> statement-breakpoint
CREATE INDEX `deferred_bonuses_vest_idx` ON `deferred_bonuses` (`status`,`vest_at`);
--> statement-breakpoint
CREATE TABLE `probation_outcomes` (
	`user_id` text NOT NULL,
	`outcome` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`decided_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `decided_at`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `clawbacks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`initiative_id` text NOT NULL,
	`trigger` text NOT NULL,
	`paid_at` text NOT NULL,
	`original_paid` real NOT NULL,
	`recalculated` real NOT NULL,
	`personally_at_fault` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'identified' NOT NULL,
	`notified_at` text,
	`months` integer DEFAULT 6 NOT NULL,
	`monthly_deduction` real DEFAULT 0 NOT NULL,
	`recovered` real DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiatives`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `clawbacks_user_idx` ON `clawbacks` (`user_id`);
--> statement-breakpoint
CREATE INDEX `clawbacks_initiative_idx` ON `clawbacks` (`initiative_id`);
--> statement-breakpoint
CREATE TABLE `share_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`from_pct` real NOT NULL,
	`to_pct` real NOT NULL,
	`proposed_at` text NOT NULL,
	`effective_from` text NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`approved_by_id` text NOT NULL,
	FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `share_adjustments_type_idx` ON `share_adjustments` (`type`,`effective_from`);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`actor_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity`,`entity_id`);
--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_id`);
