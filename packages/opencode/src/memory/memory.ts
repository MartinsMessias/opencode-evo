import { eq, desc, sql, and } from "drizzle-orm"
import { Database } from "../storage/db"
import { MemoryTable } from "./memory.sql"
import type { ProjectID } from "../project/schema"
import { ulid } from "ulid"
import { Log } from "../util/log"

export namespace Memory {
  const log = Log.create({ service: "memory" })

  export async function write(project: ProjectID, content: string) {
    log.info("memory.write", { project, content })
    return Database.use((db) =>
      db
        .insert(MemoryTable)
        .values({
          id: ulid(),
          project_id: project,
          content,
        })
        .returning()
        .get(),
    )
  }

  export async function search(project: ProjectID, query: string) {
    log.info("memory.search", { project, query })

    return Database.use((db) => {
      const q = db.select().from(MemoryTable).where(
        and(
          eq(MemoryTable.project_id, project),
          query.trim() ? sql`${MemoryTable.content} LIKE ${`%${query.replace(/%/g, "\\%")}%`}` : undefined
        )
      )

      return q.orderBy(desc(MemoryTable.time_updated)).limit(15).all()
    })
  }

  export async function all(project: ProjectID) {
    return Database.use((db) =>
      db
        .select()
        .from(MemoryTable)
        .where(eq(MemoryTable.project_id, project))
        .orderBy(desc(MemoryTable.time_updated))
        .limit(20)
        .all(),
    )
  }
}
