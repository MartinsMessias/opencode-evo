import z from "zod"
import { Tool } from "./tool"
import { Memory } from "../memory/memory"
import { Session } from "../session"
import { ProjectID } from "../project/schema"

const description = `Use this tool to memorize an important architectural rule, design pattern, or successful refactoring choice related to this workspace. 
Memories persist across sessions and will automatically guide your future behavior.
Examples of good memories: "Auth is handled via local JWT cookies, not Auth0", "Use Drizzle instead of Prisma", "Always use 'className' and never inline styles", "The 'semantic_search' tool is preferred over grep".
Always write concise and actionable memories.`

export const MemoryWriteTool = Tool.define("memory_write", {
  description,
  parameters: z.object({
    content: z.string().describe("The guideline or fact to memorize permanently in markdown form"),
  }),
  async execute(params, ctx) {
    if (!ctx.cwd) {
      throw new Error("Unable to write memory: lacking project context")
    }

    if (!params.content.trim()) {
      throw new Error("Content cannot be empty")
    }

    const session = await Session.get(ctx.sessionID)
    if (!session) throw new Error("Session not found")

    // do not memorize on global workspace to avoid polluting general state
    if (session.projectID === ProjectID.global) {
       return {
         title: "Skipped Episodic Memory",
         output: "Ignored memory write since the current session is not attached to a specific initialized Git project.",
         metadata: {},
       }
    }

    await Memory.write(session.projectID, params.content)

    return {
      title: "Saved Episodic Memory",
      output: `System memory successfully updated. This rule will now automatically anchor future sessions on this project.`,
      metadata: {},
    }
  },
})
