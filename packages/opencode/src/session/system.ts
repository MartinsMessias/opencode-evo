import { Ripgrep } from "../file/ripgrep"

import { Instance } from "../project/instance"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { Memory } from "@/memory/memory"
import { ProjectID } from "@/project/schema"
import { Log } from "@/util/log"

export namespace SystemPrompt {
  const log = Log.create({ service: "system-prompt" })

  export function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]
    if (model.api.id.includes("gpt")) {
      if (model.api.id.includes("codex")) {
        return [PROMPT_CODEX]
      }
      return [PROMPT_GPT]
    }
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
    return [PROMPT_DEFAULT]
  }

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    return [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Workspace root folder: ${Instance.worktree}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<directories>`,
        `  ${
          project.vcs === "git" && false
            ? await Ripgrep.tree({
                cwd: Instance.directory,
                limit: 50,
              })
            : ""
        }`,
        `</directories>`,
        `<tool_routing>`,
        `  When you need to find where a function/class/type is defined, who calls it, or what implements it, ALWAYS prefer the code_graph tool over grep. It uses LSP for precise structural matches.`,
        `  Use ast_patch ONLY for structural refactors: adding/removing imports, adding parameters, renaming symbols, or removing functions. For inserting or removing text/comments/lines, use the regular Edit tool.`,
        `  Use grep/ripgrep for plain text search, patterns across many files, or non-TS/JS files.`,
        `</tool_routing>`,
        `<swarm_orchestration>`,
        `  Always think in parallel. If a task is complex or involves multiple independent steps, act as an Orchestrator and use the swarm tool to delegate them to specialized subagents. Do not process them sequentially if they can be done concurrently.`,
        `</swarm_orchestration>`,
      ].join("\n"),
    ]
  }

  export async function skills(agent: Agent.Info) {
    if (Permission.disabled(["skill"], agent.permission).has("skill")) return

    const list = await Skill.available(agent)

    return [
      "Skills provide specialized instructions and workflows for specific tasks.",
      "Use the skill tool to load a skill when a task matches its description.",
      // the agents seem to ingest the information about skills a bit better if we present a more verbose
      // version of them here and a less verbose version in tool description, rather than vice versa.
      Skill.fmt(list, { verbose: true }),
    ].join("\n")
  }

  export async function memory() {
    const project = Instance.project
    if (project.id === ProjectID.global) return undefined

    try {
      const items = await Memory.all(project.id)
      if (items.length === 0) return undefined

      const lines = items.map((m) => `- ${m.content}`)
      return [
        "<project_memory>",
        "The following are previously saved rules, patterns, and preferences for this project.",
        "You MUST follow these constraints unless the user explicitly overrides them.",
        "",
        ...lines,
        "</project_memory>",
      ].join("\n")
    } catch (err) {
      log.warn("failed to load episodic memory", { err })
      return undefined
    }
  }
}

