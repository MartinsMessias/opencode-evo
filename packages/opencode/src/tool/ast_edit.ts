import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Project } from "ts-morph"
import { assertExternalDirectory } from "./external-directory"
import { FileTime } from "../file/time"
import { Format } from "../format"
import { Bus } from "../bus"
import { File } from "../file"

const log = Log.create({ service: "tool.ast_edit" })

const description = `Edit TypeScript or JavaScript files using an Abstract Syntax Tree (AST) transform script. 
This is safer than regex replacing because it guarantees syntax, braces, and indentation are preserved perfectly.
You must provide a valid Javascript snippet that mutates the provided \`source\` variable using the 'ts-morph' API.
Example: \`source.getFunction('myFunc')?.addParameter({ name: 'isRoot', type: 'boolean' })\`.
The file will be automatically saved and formatted afterward.`

export const AstEditTool = Tool.define("ast_patch", {
  description,
  parameters: z.object({
    file: z.string().describe("The absolute path to the file to modify"),
    script: z.string().describe("The TS-Morph javascript snippet to manipulate the 'source' object"),
  }),
  async execute(params, ctx) {
    if (!params.file) throw new Error("file is required")
    if (!params.script) throw new Error("script is required")

    const file = path.isAbsolute(params.file) ? params.file : path.join(ctx.cwd, params.file)
    await assertExternalDirectory(ctx, file)

    // Ask permission to edit
    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(Instance.worktree, file)],
      always: ["*"],
      metadata: {
        filepath: file,
        script: params.script,
      },
    })

    await FileTime.withLock(file, async () => {
      await FileTime.assert(ctx.sessionID, file)

      const project = new Project()
      const source = project.addSourceFileAtPath(file)
      
      const before = source.getFullText()

      const fn = new Function("source", "Project", "project", "require", `return (async () => { ${params.script} })();`)
      await fn(source, Project, project, require)

      const after = source.getFullText()

      if (before === after) {
        throw new Error("The AST script ran successfully but no changes were made to the source. Did you select the right node?")
      }

      project.saveSync()
      await Format.file(file)
      Bus.publish(File.Event.Edited, { file: file })
      await FileTime.read(ctx.sessionID, file)
    })

    return {
      title: `AST Edit applied`,
      output: `File edited structurally using ts-morph. Please review it via the read tool to verify changes if needed.`,
      metadata: {},
    }
  },
})
