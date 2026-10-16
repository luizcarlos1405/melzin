// Public browser runtime API.

export type { Issue, MelzinSchema, Snapshot } from '../core/index.ts'
export { DATA_WARNING_PREFIX, type Handlers, type MelzinView, type MountOptions, mount, mountSource } from './mount.ts'
export { type ParsedView, parseViewHtml } from './viewdoc.ts'
