// Pure helpers for the shell UI: devices, zoom, URL state and small formatters. No DOM access here,
// so tests can import this file without a browser environment.

import { VIEW_FILE_SUFFIX, isPlainObject } from 'melzin/core'

export type Device = { width: number; height: number }
export type DevicePreset = Device & { id: string; label: string }

export const DEVICE_PRESETS: readonly DevicePreset[] = [
  { id: 'phone', label: 'Phone', width: 375, height: 812 },
  { id: 'tablet', label: 'Tablet', width: 768, height: 1024 },
  { id: 'desktop', label: 'Desktop', width: 1280, height: 800 },
]

export const DEFAULT_DEVICE: DevicePreset = DEVICE_PRESETS[0]!

/** Accepted range for either side of a custom device size, in CSS pixels. */
export const DEVICE_MIN = 120
export const DEVICE_MAX = 4096

export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 2
export const ZOOM_STEPS: readonly number[] = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 1.75, 2]
export const DEFAULT_ZOOM = 1

/**
 * Parses `375x812` (also `375×812` or `375X812`) or a preset id (`phone`, `tablet`, `desktop`).
 * Returns null for anything else, including sizes outside DEVICE_MIN..DEVICE_MAX.
 */
export function parseDevice(value: string | null | undefined): Device | null {
  if (value === null || value === undefined) return null
  const text = value.trim().toLowerCase()
  const preset = DEVICE_PRESETS.find((device) => device.id === text)
  if (preset !== undefined) return { width: preset.width, height: preset.height }
  const match = /^(\d{1,5})\s*[x×]\s*(\d{1,5})$/.exec(text)
  if (match === null) return null
  const width = Number(match[1])
  const height = Number(match[2])
  const inRange = (n: number) => n >= DEVICE_MIN && n <= DEVICE_MAX
  return inRange(width) && inRange(height) ? { width, height } : null
}

/** The URL form of a device size: `375x812`. */
export function formatDevice(device: Device): string {
  return `${device.width}x${device.height}`
}

export function findPreset(device: Device): DevicePreset | undefined {
  return DEVICE_PRESETS.find((preset) => preset.width === device.width && preset.height === device.height)
}

/** `Phone 375×812`, or `Custom 500×700` for sizes that aren't presets. */
export function deviceLabel(device: Device): string {
  const name = findPreset(device)?.label ?? 'Custom'
  return `${name} ${device.width}×${device.height}`
}

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

/** Parses `0.5`, `1` or `50%`. Values outside 25%–200% are clamped; garbage returns null. */
export function parseZoom(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const text = value.trim()
  const percent = text.endsWith('%')
  const number = Number(percent ? text.slice(0, -1) : text)
  if (text === '' || text === '%' || !Number.isFinite(number) || number <= 0) return null
  return clampZoom(percent ? number / 100 : number)
}

export function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}

/** The next zoom step above (direction 1) or below (direction -1) the current zoom. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const epsilon = 1e-9
  if (direction > 0) return ZOOM_STEPS.find((step) => step > zoom + epsilon) ?? ZOOM_MAX
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - epsilon) ?? ZOOM_MIN
}

/** Everything the shell keeps in its URL. */
export type ShellState = {
  /** View name (file name minus `.mel.html`); null picks the first view. */
  view: string | null
  device: Device
  zoom: number
  /** When set, only this snapshot's frame is shown. */
  snapshot: string | null
  /** False hides the top bar, card headers and panels (for clean screenshots). */
  chrome: boolean
}

export function defaultShellState(): ShellState {
  return { view: null, device: { width: DEFAULT_DEVICE.width, height: DEFAULT_DEVICE.height }, zoom: DEFAULT_ZOOM, snapshot: null, chrome: true }
}

/** Reads `?view=counter&device=375x812&zoom=1&snapshot=zero&chrome=0`; bad values fall back to defaults. */
export function parseShellState(search: string): ShellState {
  const params = new URLSearchParams(search)
  const state = defaultShellState()
  const view = params.get('view')?.trim()
  if (view) state.view = viewName(view)
  state.device = parseDevice(params.get('device')) ?? state.device
  state.zoom = parseZoom(params.get('zoom')) ?? state.zoom
  const snapshot = params.get('snapshot')
  if (snapshot !== null && snapshot !== '') state.snapshot = snapshot
  const chrome = params.get('chrome')?.trim().toLowerCase()
  state.chrome = !(chrome === '0' || chrome === 'false' || chrome === 'no' || chrome === 'off')
  return state
}

/** The query string for a state, always with view (when known), device and zoom: `?view=…&device=…&zoom=…`. */
export function serializeShellState(state: ShellState): string {
  const params = new URLSearchParams()
  if (state.view !== null) params.set('view', state.view)
  params.set('device', formatDevice(state.device))
  params.set('zoom', String(Math.round(state.zoom * 100) / 100))
  if (state.snapshot !== null) params.set('snapshot', state.snapshot)
  if (!state.chrome) params.set('chrome', '0')
  return `?${params.toString()}`
}

/** `counter.mel.html` → `counter`; a bare name is returned unchanged. */
export function viewName(fileOrName: string): string {
  return fileOrName.endsWith(VIEW_FILE_SUFFIX) ? fileOrName.slice(0, -VIEW_FILE_SUFFIX.length) : fileOrName
}

/** `counter` → `counter.mel.html`; a file name is returned unchanged ('' stays ''). */
export function viewFileName(nameOrFile: string): string {
  return nameOrFile === '' || nameOrFile.endsWith(VIEW_FILE_SUFFIX) ? nameOrFile : `${nameOrFile}${VIEW_FILE_SUFFIX}`
}

/** The frame page for one render: `/frame?view=counter.mel.html&snapshot=zero`. */
export function frameUrl(file: string, snapshot: string | null): string {
  const params = new URLSearchParams({ view: file })
  if (snapshot !== null) params.set('snapshot', snapshot)
  return `/frame?${params.toString()}`
}

/** The view file's URL on the shell server. */
export function viewFileUrl(file: string): string {
  return `/views/${encodeURIComponent(file)}`
}

/** `14:03:27.042` in local time, for the event log. */
export function formatTime(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

export type DataParseResult = { ok: true; data: Record<string, unknown> } | { ok: false; message: string }

/** Parses the state editor's text. The data must be a JSON object. */
export function parseDataJson(text: string): DataParseResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  if (!isPlainObject(value)) return { ok: false, message: 'data must be a JSON object, like { "count": 0 }' }
  return { ok: true, data: value }
}

export function formatData(data: unknown): string {
  return JSON.stringify(data, null, 2)
}
