// Bun-side helpers for other projects (`melzin/tools`): CSS builds, reading views, checking views and
// generating host types.

export { linkFields, type Stage, viewStage } from 'melzin/core'
export { buildCss, type BuildCssOptions } from './css.ts'
export {
  checkFiles,
  checkRoutesSource,
  checkSource,
  loadRouteContext,
  formatDiagnostic,
  formatSummary,
  loadViewFile,
  loadViewSource,
  type CheckOptions,
  type CheckResult,
  type Diagnostic,
  type FileCheckResult,
  type LoadedView,
  type RouteContext,
  type RoutesCheck,
  type Severity,
} from './check.ts'
export { VIEW_FILE_HEADERS, resolveProject, resolveViewFile, type Project, type ProjectOptions } from './project.ts'
export { generateRouteTypes, generateTypes, typesPathFor } from './types.ts'
