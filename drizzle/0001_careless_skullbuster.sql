ALTER TABLE `entity` ADD `attributes` text;--> statement-breakpoint
CREATE INDEX `entity_campaign_type_idx` ON `entity` (`campaign_id`,`type`);--> statement-breakpoint
CREATE INDEX `entity_campaign_name_idx` ON `entity` (`campaign_id`,`name`);--> statement-breakpoint
ALTER TABLE `entity_link` ADD `description` text;--> statement-breakpoint
ALTER TABLE `entity_link` ADD `created_at` integer;--> statement-breakpoint
CREATE INDEX `link_from_idx` ON `entity_link` (`from_entity_id`);--> statement-breakpoint
CREATE INDEX `link_to_idx` ON `entity_link` (`to_entity_id`);--> statement-breakpoint
CREATE INDEX `link_relation_idx` ON `entity_link` (`relation`);--> statement-breakpoint
CREATE UNIQUE INDEX `link_unique_idx` ON `entity_link` (`from_entity_id`,`to_entity_id`,`relation`);--> statement-breakpoint
CREATE INDEX `event_session_idx` ON `event_log` (`session_id`);--> statement-breakpoint
CREATE INDEX `note_entity_idx` ON `note` (`entity_id`);--> statement-breakpoint
CREATE INDEX `note_session_idx` ON `note` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_campaign_number_idx` ON `session` (`campaign_id`,`number`);