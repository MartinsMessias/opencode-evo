import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Project, SyntaxKind } from "ts-morph"
import { assertExternalDirectory } from "./external-directory"
import { FileTime } from "../file/time"
import { Format } from "../format"
import { Bus } from "../bus"
import { File } from "../file"

const log = Log.create({ service: "tool.ast_edit" })

const ops = [
  "add_import",
  "remove_import",
  "add_parameter",
  "rename",
  "remove_function",
] as const

const description = `Perform structural edits on TypeScript/JavaScript files via AST (ts-morph). Use this ONLY for operations that benefit from AST awareness. For plain text edits (insert lines, remove lines, change text), use the regular Edit tool instead.

## Operations:
- add_import: Add an import. Args: { module: "...", names: ["A", "B"], default: "X" }
- remove_import: Remove an import by module specifier. Args: { module: "..." }
- add_parameter: Add a param to a function. Args: { function: "name", param: "x", type: "string" }
- rename: Rename a function/class/variable/type/interface. Args: { target: "oldName", to: "newName" }
- remove_function: Remove a function by name. Args: { target: "name" }`

export const AstEditTool = Tool.define("ast_patch", {
  description,
  parameters: z.object({
    file: z.string().describe("Absolute path to the file"),
    op: z.enum(ops).describe("Operation to perform"),
    args: z.record(z.string(), z.any()).describe("Operation arguments"),
  }),
  async execute(params, ctx) {
    if (!params.file) throw new Error("file is required")

    const file = path.isAbsolute(params.file) ? params.file : path.join(ctx.cwd, params.file)
    await assertExternalDirectory(ctx, file)

    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(Instance.worktree, file)],
      always: ["*"],
      metadata: {
        filepath: file,
        op: params.op,
        args: params.args,
      },
    })

    await FileTime.withLock(file, async () => {
      await FileTime.assert(ctx.sessionID, file)

      const project = new Project()
      const source = project.addSourceFileAtPath(file)
      const before = source.getFullText()

      switch (params.op) {
        case "add_import": {
          const mod = params.args.module as string
          if (!mod) throw new Error("args.module is required")
          const names = params.args.names as string[] | undefined
          const def = params.args.default as string | undefined
          source.addImportDeclaration({
            moduleSpecifier: mod,
            ...(names ? { namedImports: names } : {}),
            ...(def ? { defaultImport: def } : {}),
          })
          break
        }
        case "remove_import": {
          const mod = params.args.module as string
          if (!mod) throw new Error("args.module is required")
          const decl = source.getImportDeclarations().find((d) => d.getModuleSpecifierValue() === mod)
          if (!decl) throw new Error(`Import from "${mod}" not found`)
          decl.remove()
          break
        }
        case "add_parameter": {
          const fn = params.args.function as string
          const param = params.args.param as string
          const type = params.args.type as string
          if (!fn || !param) throw new Error("args.function and args.param are required")
          const target = source.getFunction(fn)
          if (!target) throw new Error(`Function "${fn}" not found`)
          target.addParameter({ name: param, type })
          break
        }
        case "rename": {
          const name = params.args.target as string
          const to = params.args.to as string
          if (!name || !to) throw new Error("args.target and args.to are required")
          const target =
            source.getFunction(name) ??
            source.getClass(name) ??
            source.getVariableDeclaration(name) ??
            source.getInterface(name) ??
            source.getTypeAlias(name)
          if (!target) throw new Error(`Symbol "${name}" not found`)
          target.rename(to)
          break
        }
        case "remove_function": {
          const name = params.args.target as string
          if (!name) throw new Error("args.target is required")
          const target = source.getFunction(name)
          if (!target) throw new Error(`Function "${name}" not found`)
          target.remove()
          break
        }
      }

      const after = source.getFullText()
      if (before === after) {
        throw new Error("Operation produced no changes. Verify arguments.")
      }

      project.saveSync()
      await Format.file(file)
      Bus.publish(File.Event.Edited, { file })
      await FileTime.read(ctx.sessionID, file)
    })

    return {
      title: `AST ${params.op}`,
      output: `Structural edit applied (${params.op}). Use read to verify.`,
      metadata: {},
    }
  },
})
