CREATE TABLE `memory` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`content` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_memory_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `memory_project_idx` ON `memory` (`project_id`);