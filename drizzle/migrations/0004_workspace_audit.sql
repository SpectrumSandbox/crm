-- Server-side, append-only audit trail of shared-workspace writes (Policy v4.0 §9.1 workings kept for audit,
-- §13.3 ten-year retention) and a rolling history of snapshot versions for rollback.
-- Written by PUT /api/workspace, POST /api/workspace/history and POST /api/admin/seed; read by GET /api/audit.

CREATE TABLE IF NOT EXISTS `workspace_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text DEFAULT 'default' NOT NULL,
	`at` text NOT NULL,                       -- server time (ISO, UTC)
	`actor` text NOT NULL,                    -- verified Access email, "demo:<email>" or "anonymous"
	`actor_source` text NOT NULL,             -- access | development | anonymous-allowed
	`actor_user_id` text,                     -- workspace user matched to the actor, if any
	`scope` text NOT NULL,                    -- full | own (data scope the writer had)
	`action` text NOT NULL,                   -- create | update | rejected | rollback | admin_seed
	`reason` text DEFAULT '' NOT NULL,        -- client-declared: edit | bootstrap | upgrade | overwrite | restore | reset | merge
	`base_version` integer NOT NULL,
	`version` integer,                        -- resulting snapshot version (null when rejected)
	`bytes` integer DEFAULT 0 NOT NULL,
	`changed` text DEFAULT '[]' NOT NULL,     -- JSON [{ key, added, removed, updated, count }]
	`protected` text DEFAULT '[]' NOT NULL,   -- JSON [collection] kept from the stored copy by the server
	`note` text DEFAULT '' NOT NULL,
	`user_agent` text DEFAULT '' NOT NULL,
	`ip` text DEFAULT '' NOT NULL
);
CREATE INDEX IF NOT EXISTS `workspace_audit_ws_id` ON `workspace_audit` (`workspace_id`, `id`);
CREATE INDEX IF NOT EXISTS `workspace_audit_actor` ON `workspace_audit` (`actor`);

-- Append-only: rows can be inserted, never changed or removed (not even by the app).
CREATE TRIGGER IF NOT EXISTS `workspace_audit_no_update` BEFORE UPDATE ON `workspace_audit`
BEGIN
	SELECT RAISE(ABORT, 'workspace_audit is append-only');
END;
CREATE TRIGGER IF NOT EXISTS `workspace_audit_no_delete` BEFORE DELETE ON `workspace_audit`
BEGIN
	SELECT RAISE(ABORT, 'workspace_audit is append-only');
END;

-- Previous snapshot versions (last 20 + the last version of each day for 30 days), for admin rollback.
CREATE TABLE IF NOT EXISTS `workspace_snapshot_history` (
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`data` text NOT NULL,
	`saved_at` text NOT NULL,
	`saved_by` text DEFAULT '' NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY (`workspace_id`, `version`)
);
