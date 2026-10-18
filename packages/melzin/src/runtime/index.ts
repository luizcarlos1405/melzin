// Public browser runtime API.

export type { Issue, MelzinSchema, Route, RouteInput, RouteTable, Snapshot } from '../core/index.ts'
export {
  type AnyRouteOf,
  type AppOptions,
  type Href,
  type HrefBuilder,
  type LoadContext,
  type MelzinApp,
  type NavigateOptions,
  type NavigateResult,
  type Page,
  type RouteOf,
  type RouteSource,
  type RouteState,
  type RouteTypes,
  type Source,
  hrefs,
  startApp,
} from './app.ts'
export { DATA_WARNING_PREFIX, type Handlers, type MelzinView, type MountOptions, mount, mountSource } from './mount.ts'
export { type ParsedView, parseViewHtml } from './viewdoc.ts'
