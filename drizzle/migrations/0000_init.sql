-- Spectrum CRM & Agile — initial schema (matches src/db/schema.ts)
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`initials` text NOT NULL,
	`email` text NOT NULL,
	`title` text NOT NULL,
	`team` text NOT NULL,
	`color` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`industry` text NOT NULL,
	`city` text NOT NULL,
	`country` text DEFAULT 'Indonesia' NOT NULL,
	`employees` integer DEFAULT 0 NOT NULL,
	`annual_revenue` integer DEFAULT 0 NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tier` text NOT NULL,
	`parent_id` text,
	`owner_id` text NOT NULL,
	`lifecycle_stage` text NOT NULL,
	`enriched` integer DEFAULT false NOT NULL,
	`linkedin` text,
	`tech_stack` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_domain_uq` ON `companies` (`domain`);
--> statement-breakpoint
CREATE INDEX `companies_parent_idx` ON `companies` (`parent_id`);
--> statement-breakpoint
CREATE INDEX `companies_owner_idx` ON `companies` (`owner_id`);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`job_title` text DEFAULT '' NOT NULL,
	`company_id` text,
	`owner_id` text NOT NULL,
	`lifecycle_stage` text NOT NULL,
	`lead_status` text NOT NULL,
	`lead_score` integer DEFAULT 0 NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`last_contacted_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_email_uq` ON `contacts` (`email`);
--> statement-breakpoint
CREATE INDEX `contacts_company_idx` ON `contacts` (`company_id`);
--> statement-breakpoint
CREATE INDEX `contacts_score_idx` ON `contacts` (`lead_score`);
--> statement-breakpoint
CREATE TABLE `pipelines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`object_type` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pipeline_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`probability` real DEFAULT 0 NOT NULL,
	`color` text NOT NULL,
	`closed` text,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stages_pipeline_idx` ON `pipeline_stages` (`pipeline_id`,`position`);
--> statement-breakpoint
CREATE TABLE `deals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`pipeline_id` text NOT NULL,
	`stage_id` text NOT NULL,
	`close_date` text NOT NULL,
	`owner_id` text NOT NULL,
	`company_id` text,
	`priority` text NOT NULL,
	`deal_type` text NOT NULL,
	`capability` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`stage_entered_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stage_id`) REFERENCES `pipeline_stages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `deals_stage_idx` ON `deals` (`pipeline_id`,`stage_id`);
--> statement-breakpoint
CREATE INDEX `deals_company_idx` ON `deals` (`company_id`);
--> statement-breakpoint
CREATE INDEX `deals_close_idx` ON `deals` (`close_date`);
--> statement-breakpoint
CREATE TABLE `deal_contacts` (
	`deal_id` text NOT NULL,
	`contact_id` text NOT NULL,
	PRIMARY KEY(`deal_id`, `contact_id`),
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`pipeline_id` text NOT NULL,
	`stage_id` text NOT NULL,
	`priority` text NOT NULL,
	`category` text NOT NULL,
	`company_id` text,
	`contact_id` text,
	`owner_id` text NOT NULL,
	`sla_due_at` text NOT NULL,
	`closed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stage_id`) REFERENCES `pipeline_stages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tickets_stage_idx` ON `tickets` (`stage_id`);
--> statement-breakpoint
CREATE INDEX `tickets_sla_idx` ON `tickets` (`sla_due_at`);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`unit_price` integer NOT NULL,
	`billing` text NOT NULL,
	`category` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`);
--> statement-breakpoint
CREATE TABLE `line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` integer NOT NULL,
	`discount_pct` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `line_items_deal_idx` ON `line_items` (`deal_id`);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`deal_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`owner_id` text NOT NULL,
	`tax_pct` real DEFAULT 11 NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_number_unique` ON `quotes` (`number`);
--> statement-breakpoint
CREATE INDEX `quotes_deal_idx` ON `quotes` (`deal_id`);
--> statement-breakpoint
CREATE TABLE `quote_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_price` integer NOT NULL,
	`discount_pct` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`subject` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`timestamp` text NOT NULL,
	`owner_id` text NOT NULL,
	`direction` text,
	`call_outcome` text,
	`duration_min` integer,
	`due_at` text,
	`done` integer,
	`issue_id` text,
	`pinned` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activities_ts_idx` ON `activities` (`timestamp`);
--> statement-breakpoint
CREATE TABLE `activity_links` (
	`activity_id` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	PRIMARY KEY(`activity_id`, `object_type`, `object_id`),
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_links_obj_idx` ON `activity_links` (`object_type`,`object_id`);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`lead_id` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_key_unique` ON `projects` (`key`);
--> statement-breakpoint
CREATE TABLE `sprints` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`state` text NOT NULL,
	`capacity` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sprints_project_idx` ON `sprints` (`project_id`,`state`);
--> statement-breakpoint
CREATE TABLE `epics` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`color` text NOT NULL,
	`status` text NOT NULL,
	`owner_id` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `epics_key_unique` ON `epics` (`key`);
--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`summary` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`priority` text NOT NULL,
	`assignee_id` text,
	`reporter_id` text NOT NULL,
	`epic_id` text,
	`sprint_id` text,
	`parent_id` text,
	`story_points` integer,
	`labels` text DEFAULT '[]' NOT NULL,
	`rank` real NOT NULL,
	`due_date` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`epic_id`) REFERENCES `epics`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprints`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issues_key_unique` ON `issues` (`key`);
--> statement-breakpoint
CREATE INDEX `issues_board_idx` ON `issues` (`project_id`,`status`,`rank`);
--> statement-breakpoint
CREATE INDEX `issues_sprint_idx` ON `issues` (`sprint_id`);
--> statement-breakpoint
CREATE INDEX `issues_epic_idx` ON `issues` (`epic_id`);
--> statement-breakpoint
CREATE TABLE `issue_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issue_comments_issue_idx` ON `issue_comments` (`issue_id`);
--> statement-breakpoint
CREATE TABLE `cross_links` (
	`id` text PRIMARY KEY NOT NULL,
	`agile_type` text NOT NULL,
	`agile_id` text NOT NULL,
	`crm_type` text NOT NULL,
	`crm_id` text NOT NULL,
	`link_type` text NOT NULL,
	`created_by_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cross_links_uq` ON `cross_links` (`agile_type`,`agile_id`,`crm_type`,`crm_id`,`link_type`);
--> statement-breakpoint
CREATE INDEX `cross_links_crm_idx` ON `cross_links` (`crm_type`,`crm_id`);
--> statement-breakpoint
CREATE INDEX `cross_links_agile_idx` ON `cross_links` (`agile_type`,`agile_id`);
--> statement-breakpoint
CREATE TABLE `email_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`category` text NOT NULL,
	`owner_id` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sequences` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sequence_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`sequence_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`delay_days` integer DEFAULT 0 NOT NULL,
	`template_id` text,
	`task_note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`sequence_id`) REFERENCES `sequences`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `email_templates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `sequence_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`sequence_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`current_step` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`enrolled_at` text NOT NULL,
	FOREIGN KEY (`sequence_id`) REFERENCES `sequences`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`trigger` text NOT NULL,
	`actions` text NOT NULL,
	`runs` integer DEFAULT 0 NOT NULL,
	`last_run_at` text
);
