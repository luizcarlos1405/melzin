// `melzin types`: TypeScript types for a view's host, generated from its schema. `Handlers` has one
// required function per declared event, so a host that misses one (or adds an undeclared one) fails
// its type check (D15).

import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { checkFiles, formatDiagnostic, loadViewFile } from './check.ts'
import { UsageError } from './project.ts'
import { generateTypes, typesPathFor } from './typegen.ts'

export { generateTypes, typesPathFor }

const TYPES_USAGE = 'usage: melzin types <files...>'

/** `melzin types <files...>`: writes `<dir>/<name>.types.ts` next to each view. Returns the exit code. */
export async function runTypes(args: string[]): Promise<number> {
  let positionals
  try {
    positionals = parseArgs({ args, allowPositionals: true, options: {} }).positionals
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\n${TYPES_USAGE}`)
  }
  if (positionals.length === 0) throw new UsageError(`no view files given\n${TYPES_USAGE}`)
  const cwd = process.cwd()
  let exitCode = 0
  for (const path of positionals) {
    const absolute = resolve(cwd, path)
    const output = typesPathFor(absolute)
    const shown = relative(cwd, output)
    const check = await checkFiles([absolute], { cwd })
    const result = check.files[0]
    if (result === undefined) continue
    if (check.errorCount > 0) {
      for (const diagnostic of result.diagnostics) {
        if (diagnostic.severity === 'error') console.error(formatDiagnostic(result.file, diagnostic))
      }
      const errors = `${check.errorCount} error${check.errorCount === 1 ? '' : 's'}`
      console.error(`melzin types: not writing ${shown}: ${result.file} has ${errors} (run melzin check)`)
      exitCode = 1
      continue
    }
    const view = await loadViewFile(absolute)
    const source = generateTypes(view.schema, basename(absolute))
    if (existsSync(output) && readFileSync(output, 'utf8') === source) {
      console.log(`${shown} is up to date`)
      continue
    }
    await writeFile(output, source)
    console.log(`wrote ${shown}`)
  }
  return exitCode
}
