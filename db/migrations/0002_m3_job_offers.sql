--> statement-breakpoint
ALTER TABLE `job_offers`
	ADD COLUMN `normalized_text` longtext DEFAULT NULL,
	ADD COLUMN `confidence` decimal(4,3) DEFAULT NULL,
	ADD COLUMN `status` enum('draft','analyzed','awaiting_critical','awaiting_optional','ready','generated','failed') NOT NULL DEFAULT 'draft',
	ADD COLUMN `questions_json` json DEFAULT NULL,
	ADD COLUMN `selection_json` json DEFAULT NULL,
	ADD COLUMN `overrides_json` json DEFAULT NULL,
	ADD COLUMN `updated_at` datetime DEFAULT NULL;
--> statement-breakpoint
UPDATE `job_offers` SET `updated_at` = `created_at`, `status` = 'draft' WHERE `updated_at` IS NULL;
--> statement-breakpoint
ALTER TABLE `job_offers`
	MODIFY COLUMN `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
--> statement-breakpoint
CREATE INDEX `m3_job_offers_user_status_idx` ON `job_offers` (`user_id`, `status`);
--> statement-breakpoint
CREATE INDEX `m3_job_offers_updated_idx` ON `job_offers` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `job_offer_generations` (
	`id` varchar(128) NOT NULL,
	`job_offer_id` varchar(128) NOT NULL,
	`generation_request_id` varchar(128) NOT NULL,
	`cv_id` varchar(128) DEFAULT NULL,
	`status` enum('running','completed','failed') NOT NULL DEFAULT 'running',
	`ats_score` int DEFAULT NULL,
	`suggestions` json DEFAULT NULL,
	`error` text DEFAULT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `job_offer_generations_id` PRIMARY KEY(`id`),
	CONSTRAINT `m3_gen_offer_fk` FOREIGN KEY (`job_offer_id`) REFERENCES `job_offers`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
	CONSTRAINT `m3_gen_cv_fk` FOREIGN KEY (`cv_id`) REFERENCES `cvs`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
	CONSTRAINT `m3_gen_offer_request_unique` UNIQUE(`job_offer_id`, `generation_request_id`)
);
--> statement-breakpoint
CREATE INDEX `m3_gen_offer_idx` ON `job_offer_generations` (`job_offer_id`);
--> statement-breakpoint
CREATE INDEX `m3_gen_cv_idx` ON `job_offer_generations` (`cv_id`);
--> statement-breakpoint
CREATE INDEX `m3_gen_status_idx` ON `job_offer_generations` (`status`);
--> statement-breakpoint
ALTER TABLE `ai_runs`
	ADD COLUMN `job_offer_id` varchar(128) DEFAULT NULL,
	ADD COLUMN `generation_request_id` varchar(128) DEFAULT NULL,
	ADD COLUMN `attempt` int NOT NULL DEFAULT 1,
	ADD CONSTRAINT `m3_ai_runs_offer_fk` FOREIGN KEY (`job_offer_id`) REFERENCES `job_offers`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX `m3_ai_runs_offer_idx` ON `ai_runs` (`job_offer_id`);
--> statement-breakpoint
CREATE INDEX `m3_ai_runs_generation_idx` ON `ai_runs` (`generation_request_id`);
