ALTER TABLE `entity_link` ADD `from_disposition` text;--> statement-breakpoint
ALTER TABLE `entity_link` ADD `to_disposition` text;--> statement-breakpoint
ALTER TABLE `entity_link` ADD `confidence` text DEFAULT 'confirmed' NOT NULL;