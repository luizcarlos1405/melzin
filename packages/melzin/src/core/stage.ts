// The stage a view is at (SPEC D28), inferred from what its file has (D33): nothing to declare, and
// the checker and the shell read it the same way.

import { type MelzinSchema, linkFields } from './schema.ts'

/** Exploration, then states, then contracts. Each is a valid place to stop (D28). */
export const STAGES = ['exploration', 'states', 'contracts'] as const
export type Stage = (typeof STAGES)[number]

/** What a view file has, as far as its stage goes. */
export type StageFacts = {
  /** The file has a melzin/schema block, valid or not. */
  schemaBlock: boolean
  /** The file has a melzin/snapshots block. */
  snapshotsBlock: boolean
  /** The schema, when it's valid. */
  schema: MelzinSchema | null
  /** A directive reads the URL input (`route.*`, D27). */
  readsRoute: boolean
}

/**
 * Contracts once the view declares an event, has a link field or reads the URL; states once it has a
 * schema or snapshots; exploration before that: static HTML with its sample content inline.
 */
export function viewStage(facts: StageFacts): Stage {
  const events = Object.keys(facts.schema?.events ?? {}).length > 0
  if (events || linkFields(facts.schema).length > 0 || facts.readsRoute) return 'contracts'
  if (facts.schemaBlock || facts.snapshotsBlock) return 'states'
  return 'exploration'
}
