// Snapshots v0: named, complete states inside the view file (P4).

import { type RouteInput, validateRouteInput } from './routes.ts'
import { type Issue, type MelzinSchema, isPlainObject, joinPath, validateData } from './schema.ts'

/** `route` is the URL input the snapshot shows the view with (SPEC D27): its params and query. */
export type Snapshot = { name: string; data: Record<string, unknown>; route?: RouteInput }

export type ParseSnapshotsOptions = {
  /** Check each snapshot's data against the schema (default true). Turn off when the schema is invalid. */
  validateData?: boolean
}

/**
 * Reads a parsed snapshots block: `{ "<name>": { "data": { ... } } }`, order preserved. A missing
 * `data` means `{}`. Snapshots whose data has issues are still returned, so a preview can show them;
 * entries that aren't objects are dropped. Issue paths look like `snapshots["a few clicks"].data.count`.
 * `schema` null means a view without a schema block (only `{}` is valid data).
 */
export function parseSnapshots(
  value: unknown,
  schema: MelzinSchema | null | undefined,
  options: ParseSnapshotsOptions = {},
): { snapshots: Snapshot[]; issues: Issue[] } {
  const snapshots: Snapshot[] = []
  const issues: Issue[] = []
  if (!isPlainObject(value)) {
    issues.push({
      message: 'snapshots must be a JSON object mapping names to { "data": { ... } }',
      path: 'snapshots',
    })
    return { snapshots, issues }
  }
  for (const [name, entry] of Object.entries(value)) {
    const path = `snapshots[${JSON.stringify(name)}]`
    if (name.trim() === '') {
      issues.push({ message: "a snapshot name can't be empty", path })
    }
    if (!isPlainObject(entry)) {
      issues.push({ message: 'a snapshot must be an object such as { "data": { ... } }', path })
      continue
    }
    for (const key of Object.keys(entry)) {
      if (key === 'data' || key === 'route') continue
      issues.push({
        message: key === 'ui' ? "internal state (ui) isn't supported yet; put the whole state in 'data'" : `unknown key '${key}'; a snapshot has 'data' and, for the URL, 'route'`,
        path: joinPath(path, key),
      })
    }
    let route: RouteInput | undefined
    if ('route' in entry) {
      const result = validateRouteInput(entry.route, joinPath(path, 'route'))
      issues.push(...result.issues)
      if (result.route !== null) route = result.route
    }
    const data = entry.data === undefined ? {} : entry.data
    if (!isPlainObject(data)) {
      issues.push({ message: "a snapshot's 'data' must be an object", path: `${path}.data` })
      continue
    }
    if (options.validateData !== false) {
      for (const issue of validateData(schema, data)) {
        const issuePath = issue.path === undefined ? `${path}.data` : `${path}.data${issue.path.startsWith('[') ? '' : '.'}${issue.path}`
        issues.push({ message: issue.message, path: issuePath })
      }
    }
    snapshots.push(route === undefined ? { name, data } : { name, data, route })
  }
  return { snapshots, issues }
}
