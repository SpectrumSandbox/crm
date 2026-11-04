-- Shared workspace snapshot (matches `workspaceSnapshots` in src/db/schema.ts).
-- One row per workspace ("default"); `data` is the JSON of every seed collection, `version` is bumped on
-- each successful write and used for optimistic concurrency (PUT /api/workspace with baseVersion).
CREATE TABLE IF NOT EXISTS `workspace_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL
);
