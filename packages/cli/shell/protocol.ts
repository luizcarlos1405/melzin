// Messages between the shell page and its frames, sent with postMessage (same origin). The frame
// acts as the view's host: it mounts the view and reports everything to the shell, which plays the
// mock host's UI (state editor, event log, warnings).

import type { Payload } from 'melzin'
import { type RouteInput, isPlainObject } from 'melzin/core'

export const FRAME_SOURCE = 'melzin-frame'
export const SHELL_SOURCE = 'melzin-shell'

/** Frame → shell. */
export type FrameMessage = { source: typeof FRAME_SOURCE } & (
  | { type: 'ready'; title: string }
  /** `payload` is the object the view sent with the event (SPEC D35); absent when it sent none. */
  | { type: 'event'; name: string; time: number; payload?: Payload }
  /** A link or form in the view that the frame didn't follow (the host page would have navigated). */
  | { type: 'link'; href: string; time: number }
  /** `update` is true for warnings about the current data (they go stale when the shell sends new data). */
  | { type: 'warning'; message: string; update?: boolean }
  | { type: 'error'; message: string }
)

/**
 * Shell → frame: replace the view's data (applied with `view.update`), or its URL input (applied with
 * `view.setRoute`, SPEC D27).
 */
export type ShellMessage =
  | { source: typeof SHELL_SOURCE; type: 'set-data'; data: Record<string, unknown> }
  | { source: typeof SHELL_SOURCE; type: 'set-route'; route: RouteInput }

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type FrameMessageBody = DistributiveOmit<FrameMessage, 'source'>

export function frameMessage(body: FrameMessageBody): FrameMessage {
  return { source: FRAME_SOURCE, ...body } as FrameMessage
}

export function setDataMessage(data: Record<string, unknown>): ShellMessage {
  return { source: SHELL_SOURCE, type: 'set-data', data }
}

export function setRouteMessage(route: RouteInput): ShellMessage {
  return { source: SHELL_SOURCE, type: 'set-route', route }
}

export function isFrameMessage(value: unknown): value is FrameMessage {
  if (!isPlainObject(value) || value.source !== FRAME_SOURCE) return false
  switch (value.type) {
    case 'ready':
      return typeof value.title === 'string'
    case 'event':
      return typeof value.name === 'string' && typeof value.time === 'number' && (value.payload === undefined || isPayload(value.payload))
    case 'link':
      return typeof value.href === 'string' && typeof value.time === 'number'
    case 'warning':
      return typeof value.message === 'string' && (value.update === undefined || typeof value.update === 'boolean')
    case 'error':
      return typeof value.message === 'string'
    default:
      return false
  }
}

/** A payload as the runtime builds it: an object of string, number or boolean fields. */
function isPayload(value: unknown): value is Payload {
  return isPlainObject(value) && Object.values(value).every((field) => typeof field === 'string' || typeof field === 'number' || typeof field === 'boolean')
}

export function isShellMessage(value: unknown): value is ShellMessage {
  if (!isPlainObject(value) || value.source !== SHELL_SOURCE) return false
  if (value.type === 'set-data') return isPlainObject(value.data)
  return value.type === 'set-route' && isPlainObject(value.route)
}
