CREATE TABLE `diagnostic_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`machine_id` text NOT NULL,
	`ingest_key` text NOT NULL,
	`result_index` integer NOT NULL,
	`test_name` text NOT NULL,
	`status` text NOT NULL,
	`fru_location` text DEFAULT '' NOT NULL,
	`failure_reason` text DEFAULT '' NOT NULL,
	`details` text,
	`result_timestamp` text NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_reports_ingest_result_uq` ON `diagnostic_reports` (`ingest_key`,`result_index`);--> statement-breakpoint
CREATE INDEX `diagnostic_reports_machine_time_idx` ON `diagnostic_reports` (`machine_id`,`result_timestamp`);--> statement-breakpoint
CREATE TABLE `machines` (
	`id` text PRIMARY KEY NOT NULL,
	`rack` text DEFAULT '' NOT NULL,
	`tray` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'healthy' NOT NULL,
	`last_report_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repair_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`machine_id` text NOT NULL,
	`fru_location` text NOT NULL,
	`part` text DEFAULT '' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`active_key` text,
	`created_by` text DEFAULT 'system' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repair_orders_active_key_uq` ON `repair_orders` (`active_key`);--> statement-breakpoint
CREATE INDEX `repair_orders_machine_status_idx` ON `repair_orders` (`machine_id`,`status`);