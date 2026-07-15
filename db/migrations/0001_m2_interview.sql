-- M2 Interview Agent: additive schema changes
-- All changes are additive — rollback by dropping this migration.

-- ─────────────────────────────────────────────────────────────────────
-- 1. interview_events — durable event log (replay authority)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE `interview_events` (
	`id` varchar(128) NOT NULL,
	`interview_id` varchar(128) NOT NULL,
	`version` int NOT NULL,
	`event_type` varchar(64) NOT NULL,
	`payload` json NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `interview_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `interview_events_interview_version_unique` UNIQUE(`interview_id`, `version`)
);
--> statement-breakpoint
CREATE INDEX `interview_events_interview_idx` ON `interview_events` (`interview_id`, `version`);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Extend `interviews` — purpose, transcript_version, last_error
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `interviews`
	ADD COLUMN `purpose` varchar(512) DEFAULT NULL,
	ADD COLUMN `transcript_version` int NOT NULL DEFAULT 0,
	ADD COLUMN `last_error` text DEFAULT NULL;

--> statement-breakpoint
UPDATE `interviews` SET `transcript_version` = 0 WHERE `transcript_version` IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Extend `ai_runs` — interview_id, status, error, provider_response_id
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `ai_runs`
	ADD COLUMN `interview_id` varchar(128) DEFAULT NULL,
	ADD COLUMN `status` enum('running','completed','failed','cancelled') NOT NULL DEFAULT 'running',
	ADD COLUMN `error` text DEFAULT NULL,
	ADD COLUMN `provider_response_id` varchar(255) DEFAULT NULL;

--> statement-breakpoint
-- Backfill existing ai_runs status to completed (they predate M2).
-- Column is NOT NULL DEFAULT 'running', so pre-existing rows get 'running'.
-- Retroactively mark them completed since they belong to M1 (before interview agent existed).
UPDATE `ai_runs` SET `status` = 'completed' WHERE `interview_id` IS NULL AND `status` = 'running';

--> statement-breakpoint
CREATE INDEX `ai_runs_interview_idx` ON `ai_runs` (`interview_id`);

--> statement-breakpoint
-- Change ai_runs.model from ENUM to VARCHAR(128) so validated provider model
-- IDs (e.g. deepseek-chat) are accepted instead of enum-only audit aliases.
ALTER TABLE `ai_runs` MODIFY COLUMN `model` varchar(128) NOT NULL;
