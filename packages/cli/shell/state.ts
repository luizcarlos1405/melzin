// Pure helpers for the shell UI: devices, zoom, URL state, the versions of a view and small
// formatters. No DOM access here, so tests can import this file without a browser environment.

import { CURRENT_VERSION, VIEW_FILE_SUFFIX, isPlainObject } from 'melzin/core'

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

/**
 * Parses a comma-separated list of devices, such as `phone,desktop` or `375x812,1280x800`: every render
 * shows at each size, side by side. Repeats are dropped. Returns null when any entry isn't a device.
 */
export function parseDevices(value: string | null | undefined): Device[] | null {
  if (value === null || value === undefined) return null
  const devices: Device[] = []
  for (const part of value.split(',')) {
    const device = parseDevice(part)
    if (device === null) return null
    if (!devices.some((seen) => sameDevice(seen, device))) devices.push(device)
  }
  return devices
}

export function sameDevice(a: Device, b: Device): boolean {
  return a.width === b.width && a.height === b.height
}

/** The URL form of a device list: `375x812,1280x800`. */
export function formatDevices(devices: readonly Device[]): string {
  return devices.map(formatDevice).join(',')
}

/** `Phone`, `Tablet` or `Desktop` for a preset, `500×700` for other sizes. */
export function deviceName(device: Device): string {
  return findPreset(device)?.label ?? `${device.width}×${device.height}`
}

/** `Phone 375×812` for one device; `Phone + Desktop` (or `Phone + 500×700`) for several. */
export function devicesLabel(devices: readonly Device[]): string {
  return devices.length === 1 ? deviceLabel(devices[0]!) : devices.map(deviceName).join(' + ')
}

/** The device picker's choices: each preset alone, then the usual combinations. */
export const DEVICE_CHOICES: readonly (readonly Device[])[] = [
  ...DEVICE_PRESETS.map((preset) => [preset]),
  [DEVICE_PRESETS[0]!, DEVICE_PRESETS[2]!],
  [...DEVICE_PRESETS],
]

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
  /** Route name: the shell shows that route's view as a page (SPEC D26). Wins over `view`. */
  route: string | null
  /** View name (file name minus `.mel.html`); with no route or view, the shell picks the first route, or the first view. */
  view: string | null
  /** Every render shows at each of these sizes, side by side; never empty. */
  devices: Device[]
  zoom: number
  /** When set, only this snapshot's frames are shown. */
  snapshot: string | null
  /**
   * When set, only this version of the view: `current` for the one in views/, or an alternative's name
   * (SPEC D31). Null shows every version side by side.
   */
  alt: string | null
  /** False hides the top bar, card headers and panels (for clean screenshots). */
  chrome: boolean
}

export function defaultShellState(): ShellState {
  return {
    route: null,
    view: null,
    devices: [{ width: DEFAULT_DEVICE.width, height: DEFAULT_DEVICE.height }],
    zoom: DEFAULT_ZOOM,
    snapshot: null,
    alt: null,
    chrome: true,
  }
}

/**
 * Reads `?view=counter&device=375x812&zoom=1&snapshot=zero&alt=night&chrome=0`, or `?route=profile&…`;
 * bad values fall back to defaults. `device` may list several sizes: `phone,desktop`.
 */
export function parseShellState(search: string): ShellState {
  const params = new URLSearchParams(search)
  const state = defaultShellState()
  const route = params.get('route')?.trim()
  const view = params.get('view')?.trim()
  if (route) state.route = route
  else if (view) state.view = viewName(view)
  state.devices = parseDevices(params.get('device')) ?? state.devices
  state.zoom = parseZoom(params.get('zoom')) ?? state.zoom
  const snapshot = params.get('snapshot')
  if (snapshot !== null && snapshot !== '') state.snapshot = snapshot
  const alt = params.get('alt')?.trim()
  if (alt) state.alt = alt
  const chrome = params.get('chrome')?.trim().toLowerCase()
  state.chrome = !(chrome === '0' || chrome === 'false' || chrome === 'no' || chrome === 'off')
  return state
}

/** The query string for a state, always with the route or view (when known), devices and zoom: `?view=…&device=…&zoom=…`. */
export function serializeShellState(state: ShellState): string {
  const params = new URLSearchParams()
  if (state.route !== null) params.set('route', state.route)
  else if (state.view !== null) params.set('view', state.view)
  params.set('device', formatDevices(state.devices))
  params.set('zoom', String(Math.round(state.zoom * 100) / 100))
  if (state.snapshot !== null) params.set('snapshot', state.snapshot)
  if (state.alt !== null) params.set('alt', state.alt)
  if (!state.chrome) params.set('chrome', '0')
  // Commas are safe in a query string, and `device=375x812,1280x800` reads better than %2C.
  return `?${params.toString().replaceAll('%2C', ',')}`
}

/** `counter.mel.html` → `counter`; a bare name is returned unchanged. */
export function viewName(fileOrName: string): string {
  return fileOrName.endsWith(VIEW_FILE_SUFFIX) ? fileOrName.slice(0, -VIEW_FILE_SUFFIX.length) : fileOrName
}

/** `counter` → `counter.mel.html`; a file name is returned unchanged ('' stays ''). */
export function viewFileName(nameOrFile: string): string {
  return nameOrFile === '' || nameOrFile.endsWith(VIEW_FILE_SUFFIX) ? nameOrFile : `${nameOrFile}${VIEW_FILE_SUFFIX}`
}

export type FrameOptions = {
  snapshot?: string | null
  /** The route the frame previews (SPEC D26). */
  route?: string | null
  /** An alternative whose own file the frame renders, with the alternative's CSS (SPEC D31). */
  alt?: string | null
  /** An alternative whose CSS (its theme, D32) the frame renders the file in views/ with. */
  theme?: string | null
}

/**
 * The frame page for one render: `/frame?view=counter.mel.html&snapshot=zero`, plus `&route=profile`
 * for a route, and `&alt=night` or `&theme=night` for an alternative.
 */
export function frameUrl(file: string, options: FrameOptions = {}): string {
  const params = new URLSearchParams({ view: file })
  for (const key of ['snapshot', 'route', 'alt', 'theme'] as const) {
    const value = options[key]
    if (value !== null && value !== undefined) params.set(key, value)
  }
  return `/frame?${params.toString()}`
}

/** The URL a route card shows: the route's path with the snapshot's params, `:name` where one is missing. */
export function routeCardUrl(path: string, params: Readonly<Record<string, string>> = {}, query: Readonly<Record<string, string>> = {}, queryNames: readonly string[] = []): string {
  const pathname = path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (whole, name: string) =>
    Object.hasOwn(params, name) && params[name] !== '' ? encodeURIComponent(params[name]!) : whole,
  )
  const search = new URLSearchParams()
  for (const name of queryNames) if (Object.hasOwn(query, name)) search.set(name, query[name]!)
  const text = search.toString()
  return text === '' ? pathname : `${pathname}?${text}`
}

/** The view file's URL on the shell server: in views/, or in an alternative's folder in explore/. */
export function viewFileUrl(file: string, alt: string | null = null): string {
  return alt === null ? `/views/${encodeURIComponent(file)}` : `/explore/${encodeURIComponent(alt)}/${encodeURIComponent(file)}`
}

/** The project's CSS on the shell server, or an alternative's (its theme over the project's, D32). */
export function stylesUrl(alt: string | null = null): string {
  return alt === null ? '/__melzin/styles.css' : `/__melzin/styles.css?alt=${encodeURIComponent(alt)}`
}

/** An alternative as the shell sees it: its name, whether it brings a theme, and its views' names. */
export type AlternativeSummary = { name: string; theme: boolean; views: readonly { name: string }[] }

/**
 * One version of a view (SPEC D31): `current` is the file in views/; an alternative either has its own
 * file (`own`) or, when it brings a theme, shows the file in views/ with that theme (D32).
 */
export type Version = { key: string; alt: string | null; own: boolean; theme: boolean }

/**
 * The versions of a view, in the order the shell shows them: the one in views/ (when `inViews`), then
 * each alternative with its own file for it, or with a theme to show the views/ one in.
 */
export function viewVersions(view: string, inViews: boolean, alternatives: readonly AlternativeSummary[]): Version[] {
  const versions: Version[] = inViews ? [{ key: CURRENT_VERSION, alt: null, own: false, theme: false }] : []
  for (const alternative of alternatives) {
    const own = alternative.views.some((entry) => entry.name === view)
    if (own || (inViews && alternative.theme)) versions.push({ key: alternative.name, alt: alternative.name, own, theme: alternative.theme })
  }
  return versions
}

/**
 * The rows of a comparison, one per snapshot name in order of first appearance across the versions'
 * lists. A version without snapshots shows once with no data, in a `null` row that comes first.
 */
export function snapshotRows(lists: readonly (readonly string[])[]): (string | null)[] {
  const names: string[] = []
  for (const list of lists) for (const name of list) if (!names.includes(name)) names.push(name)
  return lists.some((list) => list.length === 0) ? [null, ...names] : names
}

/** `14:03:27.042` in local time, for the event log. */
export function formatTime(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

/** The longest payload the event log shows whole, in characters; longer ones are cut. */
export const PAYLOAD_MAX = 80

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * An event's payload for the event log: compact JSON, such as `{"optionId":"pizza"}`. Past `max`
 * characters it's cut with an ellipsis, and `full` holds the whole JSON (for a title). A character
 * is a grapheme, what a reader sees as one, so the cut never splits an emoji: not a surrogate pair,
 * a flag, a ZWJ sequence or a skin tone, nor a letter from its accent.
 */
export function formatPayload(payload: Readonly<Record<string, unknown>>, max: number = PAYLOAD_MAX): { text: string; full?: string } {
  const json = JSON.stringify(payload)
  const chars = Array.from(graphemes.segment(json), (part) => part.segment)
  return chars.length <= max ? { text: json } : { text: `${chars.slice(0, Math.max(0, max - 1)).join('')}…`, full: json }
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
