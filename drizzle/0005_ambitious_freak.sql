CREATE TABLE `status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`lifecycle` text NOT NULL,
	`status` text,
	`since_session_number` integer,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `status_history_entity_idx` ON `status_history` (`entity_id`);--> statement-breakpoint
DROP INDEX `link_unique_idx`;--> statement-breakpoint
ALTER TABLE `entity_link` ADD `start_session_number` integer;--> statement-breakpoint
ALTER TABLE `entity_link` ADD `end_session_number` integer;--> statement-breakpoint
CREATE INDEX `link_from_to_relation_idx` ON `entity_link` (`from_entity_id`,`to_entity_id`,`relation`);--> statement-breakpoint
ALTER TABLE `entity` ADD `lifecycle` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
-- Chronology (ADR-017), hand-added below (Drizzle can't express a partial index or backfill):
-- Enforce at most ONE OPEN interval per (from,to,relation); closed intervals (severed) are exempt,
-- so a relationship can be severed and later re-formed.
CREATE UNIQUE INDEX `link_open_unique_idx` ON `entity_link` (`from_entity_id`,`to_entity_id`,`relation`) WHERE `end_session_number` IS NULL;--> statement-breakpoint
-- Backfill (deterministic; no-op on a fresh/empty DB). Derive each existing entity's lifecycle from
-- its free-text status via the keyword heuristic (mirrors lifecycleHeuristic in chronology.service).
UPDATE `entity` SET `lifecycle` = CASE
  WHEN `status` IS NULL OR trim(`status`) = '' THEN 'unknown'
  WHEN lower(`status`) LIKE '%dead%' OR lower(`status`) LIKE '%deceased%' OR lower(`status`) LIKE '%destroyed%'
    OR lower(`status`) LIKE '%ruined%' OR lower(`status`) LIKE '%disbanded%' OR lower(`status`) LIKE '%abandoned%'
    OR lower(`status`) LIKE '%gone%' THEN 'ended'
  ELSE 'active'
END;--> statement-breakpoint
-- Seed one pre-tracking baseline history row per existing entity (since_session_number NULL = origin
-- unknown), capturing the derived lifecycle + current status. Ids are random hex (internal PKs).
INSERT INTO `status_history` (`id`, `entity_id`, `lifecycle`, `status`, `since_session_number`, `recorded_at`)
  SELECT lower(hex(randomblob(16))), `id`, `lifecycle`, `status`, NULL, (CAST(strftime('%s','now') AS INTEGER) * 1000) FROM `entity`;