import { sqliteTable, text, index } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { ProjectID } from "../project/schema"
import { Timestamps } from "../storage/schema.sql"

export const MemoryTable = sqliteTable(
  "memory",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("memory_project_idx").on(table.project_id),
  ]
)
