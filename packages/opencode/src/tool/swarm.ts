import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./swarm.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { Config } from "../config/config"
import { Permission } from "@/permission"
import { Provider } from "../provider/provider"
import { defer } from "@/util/defer"

const parameters = z.object({
  tasks: z.array(
    z.object({
      description: z.string().describe("A short (3-5 words) description of the task"),
      prompt: z.string().describe("The task for the agent to perform"),
      subagent_type: z.string().describe("The type of specialized agent to use for this task"),
      model: z
        .string()
        .describe("Optional format: @ai-sdk/provider_name/model_name (e.g. @ai-sdk/anthropic/claude-3-5-haiku-20241022)")
        .optional(),
      directory: z.string().describe("Optional subdirectory path to restrict this agent's scope (e.g., 'frontend/' or 'packages/ui'). The agent will treat this as its working directory.").optional(),
    })
  ).min(1).describe("List of independent tasks to execute concurrently"),
})

export const SwarmTool = Tool.define("swarm", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => Permission.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents
  const list = accessibleAgents.toSorted((a, b) => a.name.localeCompare(b.name))

  const description = DESCRIPTION.replace(
    "{agents}",
    list
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")
      const assistantMsg = msg.info

      const executeTask = async (task: typeof params.tasks[0]) => {
        if (!ctx.extra?.bypassAgentCheck) {
          await ctx.ask({
            permission: "task",
            patterns: [task.subagent_type],
            always: ["*"],
            metadata: {
              description: task.description,
              subagent_type: task.subagent_type,
            },
          })
        }

        const agent = await Agent.get(task.subagent_type)
        if (!agent) throw new Error(`Unknown agent type: ${task.subagent_type} is not a valid agent type`)

        const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")
        const hasTodoWritePermission = agent.permission.some((rule) => rule.permission === "todowrite")

        const session = await Session.create({
          parentID: ctx.sessionID,
          title: task.description + ` (@${agent.name} subagent)`,
          directory: task.directory ? path.resolve(ctx.cwd, task.directory) : ctx.cwd,
          permission: [
            ...(hasTodoWritePermission
              ? []
              : [
                  {
                    permission: "todowrite" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(hasTaskPermission
              ? []
              : [
                  {
                    permission: "task" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })

        let activeModel = agent.model ?? {
          modelID: assistantMsg.modelID,
          providerID: assistantMsg.providerID,
        }

        if (task.model) {
          activeModel = Provider.parseModel(task.model)
        }

        const messageID = MessageID.ascending()

        function cancel() {
          SessionPrompt.cancel(session.id)
        }
        ctx.abort.addEventListener("abort", cancel)
        using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
        const promptParts = await SessionPrompt.resolvePromptParts(task.prompt)

        const result = await SessionPrompt.prompt({
          messageID,
          sessionID: session.id,
          model: {
            modelID: activeModel.modelID,
            providerID: activeModel.providerID,
          },
          agent: agent.name,
          tools: {
            ...(hasTodoWritePermission ? {} : { todowrite: false }),
            ...(hasTaskPermission ? {} : { task: false }),
            ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
          },
          parts: promptParts,
        })

        const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

        return [
          `--- SWARM TASK: ${task.description} (@${task.subagent_type}) ---`,
          `task_id: ${session.id}`,
          "<task_result>",
          text,
          "</task_result>",
        ].join("\n")
      }

      ctx.metadata({
        title: `Swarming ${params.tasks.length} subagents`,
      })

      const results = await Promise.all(params.tasks.map(t => executeTask(t).catch((err) => `Task failed: ${t.description} - Error: ${err.message}`)));

      return {
        title: `Swarmed ${params.tasks.length} independent subagents`,
        metadata: {
          numberOfTasks: params.tasks.length,
        },
        output: results.join("\n\n"),
      }
    },
  }
})
