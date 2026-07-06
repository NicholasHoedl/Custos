PRAGMA foreign_keys=OFF;--> statement-breakpoint
DELETE FROM `note` WHERE NOT EXISTS (SELECT 1 FROM `note_entity` `ne` WHERE `ne`.`note_id` = `note`.`id`);--> statement-breakpoint
CREATE TABLE `__new_note` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`session_id` text,
	`content` text NOT NULL,
	`tags` text,
	`confidence` text DEFAULT 'confirmed' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaign`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_note`("id", "campaign_id", "session_id", "content", "tags", "confidence", "created_at") SELECT "n"."id", (SELECT "e"."campaign_id" FROM `note_entity` "ne" JOIN `entity` "e" ON "e"."id" = "ne"."entity_id" WHERE "ne"."note_id" = "n"."id" LIMIT 1), "n"."session_id", "n"."content", "n"."tags", 'confirmed', "n"."created_at" FROM `note` "n";--> statement-breakpoint
DROP TABLE `note`;--> statement-breakpoint
ALTER TABLE `__new_note` RENAME TO `note`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `note_session_idx` ON `note` (`session_id`);--> statement-breakpoint
CREATE INDEX `note_campaign_idx` ON `note` (`campaign_id`);
