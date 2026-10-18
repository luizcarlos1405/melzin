// `melzin types`: TypeScript types for a view's host, generated from its schema. `Handlers` has one
// required function per declared event, so a host that misses one (or adds an undeclared one) fails
// its type check (D15). For routes.json it writes routes.types.ts, the types of a typed source (D20),
// and the types of every view a route shows.

import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ROUTES_FILE, VIEW_FILE_SUFFIX } from 'melzin/core'
import { checkFiles, checkRoutesSource, formatDiagnostic, loadViewFile } from './check.ts'
import { UsageError, resolveProject } from './project.ts'
import { generateRouteTypes, generateTypes, routeTypesPathFor, typesPathFor, viewTypesImport } from './typegen.ts'

export { generateRouteTypes, generateTypes, typesPathFor }

const TYPES_USAGE = 'usage: melzin types <files...> [--views dir]'

/** Writes a generated file unless it's already up to date, and says which. */
async function writeIfChanged(output: string, source: string, shown: string): Promise<void> {
  if (existsSync(output) && readFileSync(output, 'utf8') === source) {
    console.log(`${shown} is up to date`)
    return
  }
  await writeFile(output, source)
  console.log(`wrote ${shown}`)
}

/** routes.json → routes.types.ts, after the types of every view a route shows. Returns the exit code. */
async function routeTypes(absolute: string, cwd: string, views: string | undefined): Promise<number> {
  const project = resolveProject({ cwd, views })
  const names = project.listViews().map((path) => basename(path).slice(0, -VIEW_FILE_SUFFIX.length))
  const file = relative(cwd, absolute) || absolute
  const output = routeTypesPathFor(absolute)
  let source: string
  try {
    source = await readFile(absolute, 'utf8')
  } catch {
    console.error(`melzin types: can't read ${file}`)
    return 1
  }
  const { diagnostics, table } = checkRoutesSource(source, names)
  if (table === null) {
    for (const diagnostic of diagnostics) console.error(formatDiagnostic(file, diagnostic))
    console.error(`melzin types: not writing ${relative(cwd, output)}: ${file} has errors (run melzin check)`)
    return 1
  }
  let exitCode = 0
  for (const view of new Set(table.routes.map((route) => route.view))) {
    exitCode = Math.max(exitCode, await viewTypes(join(project.viewsDir, `${view}${VIEW_FILE_SUFFIX}`), cwd, views))
  }
  if (exitCode !== 0) {
    console.error(`melzin types: not writing ${relative(cwd, output)}: a view it needs has errors`)
    return exitCode
  }
  await writeIfChanged(output, generateRouteTypes(table, (view) => viewTypesImport(output, project.viewsDir, view), basename(absolute)), relative(cwd, output))
  return 0
}

/** A view → `<name>.types.ts` next to it. Returns the exit code. */
async function viewTypes(absolute: string, cwd: string, views: string | undefined): Promise<number> {
  const output = typesPathFor(absolute)
  const shown = relative(cwd, output)
  const check = await checkFiles([absolute], { cwd, viewsDir: views })
  const result = check.files[0]
  if (result === undefined) return 0
  if (check.errorCount > 0) {
    for (const diagnostic of result.diagnostics) {
      if (diagnostic.severity === 'error') console.error(formatDiagnostic(result.file, diagnostic))
    }
    const errors = `${check.errorCount} error${check.errorCount === 1 ? '' : 's'}`
    console.error(`melzin types: not writing ${shown}: ${result.file} has ${errors} (run melzin check)`)
    return 1
  }
  const view = await loadViewFile(absolute)
  await writeIfChanged(output, generateTypes(view.schema, basename(absolute)), shown)
  return 0
}

/**
 * `melzin types <files...>`: writes `<dir>/<name>.types.ts` next to each view, and for routes.json
 * writes routes.types.ts (and the types of the views its routes show). Returns the exit code.
 */
export async function runTypes(args: string[]): Promise<number> {
  let positionals
  let values
  try {
    ;({ positionals, values } = parseArgs({ args, allowPositionals: true, options: { views: { type: 'string' } } }))
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\n${TYPES_USAGE}`)
  }
  if (positionals.length === 0) throw new UsageError(`no view files given\n${TYPES_USAGE}`)
  const cwd = process.cwd()
  let exitCode = 0
  for (const path of positionals) {
    const absolute = resolve(cwd, path)
    const code = basename(absolute) === ROUTES_FILE ? await routeTypes(absolute, cwd, values.views) : await viewTypes(absolute, cwd, values.views)
    exitCode = Math.max(exitCode, code)
  }
  return exitCode
}
