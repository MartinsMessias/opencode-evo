import z from "zod"
import path from "path"
import fs from "fs/promises"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { Instance } from "../project/instance"
import { fileURLToPath } from "url"

const actions = ["definition", "usages", "implementations", "callers"] as const

export const SemanticSearchTool = Tool.define("code_graph", {
  description:
    "Perform semantic Code RAG (AST Dependency Graph). Use this to find exact usages, callers, implementations, or definitions of a function, class, or variable anywhere in the workspace without having to guess file coordinates via regex.",
  parameters: z.object({
    target: z.string().describe("The exact name of the function, class, type, or variable to investigate"),
    action: z.enum(actions).describe("The LSP semantic action to perform on the target"),
  }),
  execute: async (args, ctx) => {
    await ctx.ask({
      permission: "lsp",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const symbols = await LSP.workspaceSymbol(args.target)

    // Prioritize exact matches
    let matches = symbols.filter((s) => s.name === args.target)
    if (matches.length === 0) matches = symbols

    if (matches.length === 0) {
      return {
        output: `No symbol found matching '${args.target}' in the workspace.`,
        title: "Semantic Code Search",
        metadata: {},
      }
    }

    // Process top 5 matches
    matches = matches.slice(0, 5)

    const results: string[] = []

    for (const match of matches) {
      if (!match.location?.uri) continue

      const file = fileURLToPath(match.location.uri)
      const position = {
        file,
        line: match.location.range.start.line,
        character: match.location.range.start.character,
      }

      await LSP.touchFile(file, true)

      type Loc = Record<string, any>
      let locs: Loc[] = []
      try {
        switch (args.action) {
          case "definition":
            locs = await LSP.definition(position)
            break
          case "usages":
            locs = await LSP.references(position)
            break
          case "implementations":
            locs = await LSP.implementation(position)
            break
          case "callers":
            locs = await LSP.incomingCalls(position)
            break
        }
      } catch (err) {
        continue
      }

      if (!locs || locs.length === 0) continue

      if (args.action === "callers") {
        for (const loc of locs) {
          if (!loc.from?.uri) continue
          const caller = fileURLToPath(loc.from.uri)
          const line = loc.from.range.start.line
          const snippet = await readSnippet(caller, line)
          const rel = path.relative(Instance.worktree, caller)
          results.push(`Caller: ${loc.from.name}\nLocation: ${rel}:${line + 1}\n\`\`\`ts\n${snippet}\n\`\`\``)
        }
        continue
      }

      for (const loc of locs) {
        if (!loc.uri) continue
        const dest = fileURLToPath(loc.uri)
        const line = loc.range.start.line
        const snippet = await readSnippet(dest, line)
        const rel = path.relative(Instance.worktree, dest)
        results.push(`Location: ${rel}:${line + 1}\n\`\`\`ts\n${snippet}\n\`\`\``)
      }
    }

    if (results.length === 0) {
      return {
        output: `No ${args.action} found for '${args.target}'.`,
        title: `Semantic Search: ${args.action}`,
        metadata: {},
      }
    }

    // Deduplicate results
    const unique = Array.from(new Set(results)).slice(0, 15)

    const output = [
      `Found ${unique.length} RAG results for ${args.action} of '${args.target}':`,
      "",
      ...unique,
    ].join("\n\n---\n\n")

    return {
      output,
      title: `RAG: ${args.action} for ${args.target}`,
      metadata: {},
    }
  },
})

async function readSnippet(file: string, center: number): Promise<string> {
  try {
    const content = await fs.readFile(file, "utf8")
    const lines = content.split("\n")
    const start = Math.max(0, center - 3)
    const end = Math.min(lines.length - 1, center + 4)

    return lines
      .slice(start, end + 1)
      .map((line, idx) => `${start + idx + 1}: ${line}`)
      .join("\n")
  } catch {
    return "(Context unavailable)"
  }
}
