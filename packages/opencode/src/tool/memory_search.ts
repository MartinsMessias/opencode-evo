import z from "zod"
import { Tool } from "./tool"
import { Memory } from "../memory/memory"
import { Session } from "../session"
import { ProjectID } from "../project/schema"

const description = `Search through the workspace's episodic memory logs. 
Memories contain important architectural rules, decisions, or preferred patterns specifically learned for the project. 
Use this if you are newly spawned and want to ensure you aren't violating any learned constraints.`

export const MemorySearchTool = Tool.define("memory_search", {
  description,
  parameters: z.object({
    query: z.string().describe("Topic or keyword to look for in the memory base."),
  }),
  async execute(params, ctx) {
    if (!ctx.cwd) {
      throw new Error("Unable to read memory: lacking project context")
    }

    const session = await Session.get(ctx.sessionID)
    if (!session) throw new Error("Session not found")

    if (session.projectID === ProjectID.global) {
       return {
         title: "Skipped Episodic Memory",
         output: "The current session is not attached to a specific initialized Git project. No context available.",
         metadata: {},
       }
    }

    const results = await Memory.search(session.projectID, params.query)

    if (results.length === 0) {
      return {
        title: "No Memory Matches",
        output: "No previous instructions or rules found regarding this topic in the project history.",
        metadata: {},
      }
    }

    const output = results.map(r => `- ${r.content}`).join("\n\n")

    return {
      title: "Episodic Memory Retrieved",
      output: `Past project constraints and rules:\n\n${output}`,
      metadata: {},
    }
  },
})
