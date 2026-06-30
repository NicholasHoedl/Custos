CREATE TABLE `note_entity` (
	`note_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`note_id`, `entity_id`),
	FOREIGN KEY (`note_id`) REFERENCES `note`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_entity_entity_idx` ON `note_entity` (`entity_id`);--> statement-breakpoint
-- Backfill the join table from the legacy single-entity column. Runs before 0004 drops
-- note.entity_id, so every existing note keeps its association. No-op on a fresh (empty) DB.
INSERT INTO `note_entity` (`note_id`, `entity_id`, `created_at`) SELECT `id`, `entity_id`, `created_at` FROM `note`;