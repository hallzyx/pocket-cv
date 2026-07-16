--> statement-breakpoint
ALTER TABLE `ai_runs` DROP FOREIGN KEY `m3_ai_runs_offer_fk`;
--> statement-breakpoint
DROP INDEX `m3_ai_runs_offer_idx` ON `ai_runs`;
--> statement-breakpoint
DROP INDEX `m3_ai_runs_generation_idx` ON `ai_runs`;
--> statement-breakpoint
ALTER TABLE `ai_runs` DROP COLUMN `attempt`, DROP COLUMN `generation_request_id`, DROP COLUMN `job_offer_id`;
--> statement-breakpoint
DROP TABLE `job_offer_generations`;
--> statement-breakpoint
DROP INDEX `m3_job_offers_updated_idx` ON `job_offers`;
--> statement-breakpoint
DROP INDEX `m3_job_offers_user_status_idx` ON `job_offers`;
--> statement-breakpoint
ALTER TABLE `job_offers` DROP COLUMN `updated_at`, DROP COLUMN `overrides_json`, DROP COLUMN `selection_json`, DROP COLUMN `questions_json`, DROP COLUMN `status`, DROP COLUMN `confidence`, DROP COLUMN `normalized_text`;
