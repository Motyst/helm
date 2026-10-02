ALTER TABLE `tasks` ADD `today` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `today_at` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `today_only` integer DEFAULT false NOT NULL;