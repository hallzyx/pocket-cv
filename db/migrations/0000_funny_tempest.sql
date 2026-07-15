CREATE TABLE `ai_runs` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(128) NOT NULL,
	`model` enum('v4-flash','v4-pro') NOT NULL,
	`task` varchar(128) NOT NULL,
	`tokens_in` int NOT NULL DEFAULT 0,
	`tokens_out` int NOT NULL DEFAULT 0,
	`cost_usd` decimal(10,6) NOT NULL DEFAULT '0',
	`created_at` datetime NOT NULL,
	CONSTRAINT `ai_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cvs` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(128) NOT NULL,
	`job_offer_id` varchar(128),
	`title` varchar(255) NOT NULL,
	`content_json` json NOT NULL,
	`tex_source` longtext,
	`ats_score` int,
	`source` enum('manual','ai') NOT NULL DEFAULT 'manual',
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `cvs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `interviews` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(128) NOT NULL,
	`status` enum('active','completed','paused') NOT NULL DEFAULT 'active',
	`transcript` json DEFAULT ('[]'),
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `interviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_offers` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(128) NOT NULL,
	`raw_text` longtext NOT NULL,
	`extracted_keywords` json DEFAULT ('[]'),
	`detected_category` varchar(128),
	`created_at` datetime NOT NULL,
	CONSTRAINT `job_offers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `professional_profile` (
	`id` varchar(128) NOT NULL,
	`user_id` varchar(128) NOT NULL,
	`personal_info` json,
	`experiences` json DEFAULT ('[]'),
	`education` json DEFAULT ('[]'),
	`skills` json DEFAULT ('[]'),
	`projects` json DEFAULT ('[]'),
	`achievements` json DEFAULT ('[]'),
	`preferences` json,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `professional_profile_id` PRIMARY KEY(`id`),
	CONSTRAINT `professional_profile_user_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` varchar(36) NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` timestamp(3),
	`refresh_token_expires_at` timestamp(3),
	`scope` text,
	`password` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `account_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` varchar(36) NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`token` varchar(255) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	`ip_address` text,
	`user_agent` text,
	`user_id` varchar(36) NOT NULL,
	CONSTRAINT `session_id` PRIMARY KEY(`id`),
	CONSTRAINT `session_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`email_verified` boolean NOT NULL DEFAULT false,
	`image` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `user_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` varchar(36) NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`value` text NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `verification_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `account` ADD CONSTRAINT `account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `session` ADD CONSTRAINT `session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ai_runs_user_idx` ON `ai_runs` (`user_id`);--> statement-breakpoint
CREATE INDEX `ai_runs_created_idx` ON `ai_runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `cvs_user_idx` ON `cvs` (`user_id`);--> statement-breakpoint
CREATE INDEX `cvs_job_offer_idx` ON `cvs` (`job_offer_id`);--> statement-breakpoint
CREATE INDEX `interviews_user_idx` ON `interviews` (`user_id`);--> statement-breakpoint
CREATE INDEX `job_offers_user_idx` ON `job_offers` (`user_id`);--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);