// The preview shell: lists the project's routes (as pages, SPEC D26) and views, renders one card per
// snapshot, with a frame per device size, at a zoom, and plays the mock host's UI for each card (state
// editor, URL, event log, warnings). A view with design alternatives in explore/ shows every version
// side by side, one column each (SPEC D31). All state worth sharing lives in the URL (see state.ts), so
// a refresh reloads everything from the files (D3).

import { type Issue, type Payload, type Route, type Snapshot, parseViewHtml } from 'melzin'
import { CURRENT_VERSION, type Stage, matchPath, matchRoute } from 'melzin/core'
import { type FrameMessage, isFrameMessage, setDataMessage, setRouteMessage } from './protocol.ts'
import {
  DEVICE_CHOICES,
  DEVICE_MAX,
  DEVICE_MIN,
  type Device,
  type FrameStatus,
  type ShellState,
  type Version,
  ZOOM_STEPS,
  deviceLabel,
  deviceName,
  devicesLabel,
  formatData,
  formatDevices,
  formatPayload,
  formatTime,
  frameUrl,
  missingPage,
  pageReady,
  parseDataJson,
  parseDevices,
  parseShellState,
  routeCardUrl,
  sameDevice,
  serializeShellState,
  snapshotRows,
  stepZoom,
  viewFileUrl,
  viewVersions,
  zoomLabel,
} from './state.ts'
// Zin, the Melzin bee. Bun's bundler turns these imports into asset URLs.
import zinOps from './zin-ops.svg'
import zinSoneca from './zin-soneca.svg'

type ViewEntry = { name: string; file: string; url: string; title: string; description: string; stage: Stage }
type AlternativeEntry = { name: string; theme: boolean; views: ViewEntry[] }
type ExploreEntry = { alternatives: AlternativeEntry[]; problems: string[] }
type RoutesEntry = { present: boolean; routes: Route[]; problems: string[] }

/** A version of the picked view (SPEC D31) and the file it renders. */
type VersionEntry = Version & { entry: ViewEntry }

/** A version once its file is loaded. `events` is true when its schema declares any. */
type LoadedVersion = VersionEntry & { title: string; snapshots: Snapshot[]; issues: Issue[]; events: boolean }

/** `route` is set when the view shows as that route's page. `versions` are the ones shown, out of `all`. */
type LoadedView = { name: string; route: Route | null; all: VersionEntry[]; versions: LoadedVersion[] }

type WarningEntry = { count: number; badge: HTMLElement; item: HTMLLIElement; update: boolean }

/** One render: an iframe at one device size. */
type Frame = { device: Device; wrap: HTMLElement; iframe: HTMLIFrameElement; status: FrameStatus }

type Card = {
  version: LoadedVersion
  /** null for the single card of a version without snapshots. */
  snapshot: Snapshot | null
  /** The route the card shows its view as (SPEC D26), or null. */
  route: Route | null
  /** One per device size, sharing the card's state, URL and logs. */
  frames: Frame[]
  root: HTMLElement
  statusBadge: HTMLElement
  editor: HTMLTextAreaElement
  editorError: HTMLElement
  editedBadge: HTMLElement
  /** The address bar of a route card (null for views shown on their own). */
  urlInput: HTMLInputElement | null
  urlError: HTMLElement | null
  log: HTMLOListElement
  logEmpty: HTMLElement
  eventCount: HTMLElement
  warningList: HTMLUListElement
  warningEmpty: HTMLElement
  warningCount: HTMLElement
  warnings: Map<string, WarningEntry>
  events: number
  debounce: ReturnType<typeof setTimeout> | undefined
}

// ---------------------------------------------------------------------------------------------------
// DOM helpers (textContent only; nothing is ever parsed as HTML)

type Props = { class?: string; text?: string; title?: string; attrs?: Record<string, string> }

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (props.class !== undefined) el.className = props.class
  if (props.text !== undefined) el.textContent = props.text
  if (props.title !== undefined) el.title = props.title
  for (const [name, value] of Object.entries(props.attrs ?? {})) el.setAttribute(name, value)
  for (const child of children) if (child !== null) el.append(child)
  return el
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (el === null) throw new Error(`melzin shell: #${id} is missing`)
  return el as T
}

const viewPicker = byId<HTMLSelectElement>('view-picker')
const altControl = byId<HTMLElement>('alt-control')
const altPicker = byId<HTMLSelectElement>('alt-picker')
const devicePicker = byId<HTMLSelectElement>('device-picker')
const zoomPicker = byId<HTMLSelectElement>('zoom-picker')
const zoomIn = byId<HTMLButtonElement>('zoom-in')
const zoomOut = byId<HTMLButtonElement>('zoom-out')
const reloadButton = byId<HTMLButtonElement>('reload')
const viewMeta = byId<HTMLElement>('view-meta')
const notices = byId<HTMLElement>('notices')
const canvas = byId<HTMLElement>('canvas')

// ---------------------------------------------------------------------------------------------------
// State

let state: ShellState = parseShellState(location.search)
let views: ViewEntry[] = []
let explore: ExploreEntry = { alternatives: [], problems: [] }
let routesEntry: RoutesEntry = { present: false, routes: [], problems: [] }
let loaded: LoadedView | null = null
let cards: Card[] = []
let loadToken = 0
let editorIds = 0
/**
 * True when the page can't show what its URL asks for: an unknown view, route, alternative or
 * snapshot, or a version's file that couldn't be fetched. The page is then ready with an error.
 */
let loadFailed = false
/** Links to a variation of the current state ("Open alone"), refreshed when the state changes. */
let stateLinks: { el: HTMLAnchorElement; changes: Partial<ShellState> }[] = []

function urlFor(changes: Partial<ShellState>): string {
  return serializeShellState({ ...state, ...changes })
}

function updateUrl(): void {
  history.replaceState(null, '', serializeShellState(state) + location.hash)
  for (const link of stateLinks) link.el.href = urlFor(link.changes)
}

function stateLink(props: Props, changes: Partial<ShellState>): HTMLAnchorElement {
  const el = h('a', { ...props, attrs: { ...props.attrs, href: urlFor(changes) } })
  stateLinks.push({ el, changes })
  return el
}

// ---------------------------------------------------------------------------------------------------
// Views and their versions (SPEC D31)

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** Every version of a view: the one in views/, then its alternatives in explore/. */
function versionsOf(name: string): VersionEntry[] {
  const current = views.find((view) => view.name === name)
  return viewVersions(name, current !== undefined, explore.alternatives).flatMap((version) => {
    const alternative = explore.alternatives.find((item) => item.name === version.alt)
    const entry = version.own ? alternative?.views.find((view) => view.name === name) : current
    return entry === undefined ? [] : [{ ...version, entry }]
  })
}

/** View names that only exist in explore/: screens still being explored. */
function exploringNames(): string[] {
  const names = new Set<string>()
  for (const alternative of explore.alternatives) for (const view of alternative.views) names.add(view.name)
  for (const view of views) names.delete(view.name)
  return [...names].sort()
}

/** `explore/night/settings.mel.html`, or the file name for the version in views/. */
function versionPath(version: VersionEntry): string {
  return version.own ? `explore/${version.alt}/${version.entry.file}` : version.entry.file
}

/** What a version is, for pickers and headers: `current`, `night · own theme`, `night · theme only`. */
function versionLabel(version: Version): string {
  if (version.alt === null) return CURRENT_VERSION
  if (!version.own) return `${version.alt} · theme only`
  return version.theme ? `${version.alt} · own theme` : version.alt
}

/** ` · 2 alternatives` for a view with alternatives, '' otherwise. */
function alternativesSuffix(name: string): string {
  const count = versionsOf(name).filter((version) => version.alt !== null).length
  return count === 0 ? '' : ` · ${plural(count, 'alternative')}`
}

// ---------------------------------------------------------------------------------------------------
// Top bar

function renderDevicePicker(): void {
  const choices = [...DEVICE_CHOICES]
  const same = (list: readonly Device[]) => list.length === state.devices.length && list.every((device, i) => sameDevice(device, state.devices[i]!))
  if (!choices.some(same)) choices.push(state.devices)
  devicePicker.replaceChildren(...choices.map((choice) => h('option', { text: devicesLabel(choice), attrs: { value: formatDevices(choice) } })))
  devicePicker.value = formatDevices(state.devices)
}

function renderZoomPicker(): void {
  const steps = ZOOM_STEPS.includes(state.zoom) ? ZOOM_STEPS : [...ZOOM_STEPS, state.zoom].sort((a, b) => a - b)
  zoomPicker.replaceChildren(...steps.map((step) => h('option', { text: zoomLabel(step), attrs: { value: String(step) } })))
  zoomPicker.value = String(state.zoom)
  zoomOut.disabled = state.zoom <= steps[0]!
  zoomIn.disabled = state.zoom >= steps[steps.length - 1]!
}

// Picker values say what they pick: `route:profile` or `view:profile-card`.
const pickerValue = (kind: 'route' | 'view', name: string): string => `${kind}:${name}`

function currentPickerValue(): string {
  if (state.route !== null) return routesEntry.routes.some((route) => route.name === state.route) ? pickerValue('route', state.route) : ''
  const view = loaded?.name ?? pickView()?.name
  return view === undefined ? '' : pickerValue('view', view)
}

function renderViewPicker(): void {
  const exploring = exploringNames()
  if (views.length === 0 && exploring.length === 0) {
    viewPicker.replaceChildren(h('option', { text: 'No views', attrs: { value: '' } }))
    viewPicker.disabled = true
    return
  }
  viewPicker.disabled = false
  const titles = new Map<string, number>()
  for (const view of views) titles.set(view.title, (titles.get(view.title) ?? 0) + 1)
  const viewOptions = views.map((view) => {
    const label = (titles.get(view.title) ?? 0) > 1 ? `${view.title} (${view.file})` : view.title
    return h('option', { text: label + alternativesSuffix(view.name), title: view.file, attrs: { value: pickerValue('view', view.name) } })
  })
  // Screens that only exist as alternatives, titled after their first one.
  const exploringOptions = exploring.map((name) => {
    const versions = versionsOf(name)
    const title = versions[0]?.entry.title ?? name
    return h('option', { text: title + alternativesSuffix(name), title: `explore/*/${name}.mel.html`, attrs: { value: pickerValue('view', name) } })
  })
  const routeOptions = routesEntry.routes.map((route) =>
    h('option', { text: `${route.path}  (${route.name})${alternativesSuffix(route.view)}`, title: `${route.view}.mel.html`, attrs: { value: pickerValue('route', route.name) } }),
  )
  const groups: [string, HTMLOptionElement[]][] = [['Pages', routeOptions], ['Views', viewOptions], ['Exploring', exploringOptions]]
  const used = groups.filter(([, options]) => options.length > 0)
  if (used.length === 1 && used[0]![0] === 'Views') viewPicker.replaceChildren(...viewOptions)
  else viewPicker.replaceChildren(...used.map(([label, options]) => h('optgroup', { attrs: { label } }, ...options)))
  // The requested view even when its file failed to load; blank for a name that matches nothing.
  viewPicker.value = currentPickerValue()
}

/** The version picker: every version of the view, or nothing when it has only one. */
function renderAltPicker(): void {
  const all = loaded?.all ?? []
  altControl.hidden = all.length < 2
  if (all.length < 2) return
  const options = [h('option', { text: 'All side by side', attrs: { value: '' } })]
  for (const version of all) options.push(h('option', { text: versionLabel(version), title: versionPath(version), attrs: { value: version.key } }))
  if (state.alt !== null && !all.some((version) => version.key === state.alt)) options.push(h('option', { text: `${state.alt} (missing)`, attrs: { value: state.alt } }))
  altPicker.replaceChildren(...options)
  altPicker.value = state.alt ?? ''
}

function setDevices(devices: Device[]): void {
  state.devices = devices
  renderDevicePicker()
  // Each card has a frame per device, so the cards are built again.
  updateUrl()
  void loadCurrentView()
}

function setZoom(zoom: number): void {
  state.zoom = zoom
  renderZoomPicker()
  applyLayout()
  updateUrl()
}

devicePicker.addEventListener('change', () => {
  const devices = parseDevices(devicePicker.value)
  if (devices !== null) setDevices(devices)
})
zoomPicker.addEventListener('change', () => setZoom(Number(zoomPicker.value)))
zoomIn.addEventListener('click', () => setZoom(stepZoom(state.zoom, 1)))
zoomOut.addEventListener('click', () => setZoom(stepZoom(state.zoom, -1)))
viewPicker.addEventListener('change', () => {
  const [kind, ...rest] = viewPicker.value.split(':')
  const name = rest.join(':')
  state.route = kind === 'route' ? name : null
  state.view = kind === 'view' ? name : null
  state.snapshot = null
  state.alt = null
  updateUrl()
  void loadCurrentView()
})
altPicker.addEventListener('change', () => {
  state.alt = altPicker.value === '' ? null : altPicker.value
  updateUrl()
  void loadCurrentView()
})
reloadButton.addEventListener('click', () => void reloadAll())

document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null
  if (target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.key === '+' || event.key === '=') setZoom(stepZoom(state.zoom, 1))
  else if (event.key === '-') setZoom(stepZoom(state.zoom, -1))
  else if (event.key === '0') setZoom(1)
})

// ---------------------------------------------------------------------------------------------------
// Notices

function notice(kind: 'error' | 'warning' | 'info', title: string, lines: string[] = [], action?: { text: string; changes: Partial<ShellState> }): HTMLElement {
  const el = h('div', { class: `notice notice-${kind}` }, h('strong', { text: title }))
  if (kind === 'error') el.prepend(h('img', { class: 'notice-zin', attrs: { src: zinOps, alt: '' } }))
  if (lines.length > 0) el.append(h('ul', {}, ...lines.map((line) => h('li', { text: line }))))
  if (action !== undefined) el.append(stateLink({ class: 'notice-action', text: action.text }, action.changes))
  return el
}

function issueLine(issue: Issue): string {
  return issue.path === undefined ? issue.message : `${issue.path}: ${issue.message}`
}

// ---------------------------------------------------------------------------------------------------
// Cards

function cardStatus(card: Card): FrameStatus {
  if (card.frames.some((frame) => frame.status === 'error')) return 'error'
  return card.frames.some((frame) => frame.status === 'loading') ? 'loading' : 'ready'
}

function setFrameStatus(card: Card, frame: Frame, status: FrameStatus): void {
  frame.status = status
  const overall = cardStatus(card)
  card.statusBadge.className = `status status-${overall}`
  card.statusBadge.textContent = overall === 'loading' ? 'loading' : overall === 'ready' ? 'live' : 'error'
  markReady()
}

/** Sets `data-melzin-ready` on `<body>` once no frame is loading (SPEC §8). */
function markReady(): void {
  const ready = pageReady(loadFailed, cards.flatMap((card) => card.frames.map((frame) => frame.status)))
  if (ready !== undefined) document.body.dataset.melzinReady = ready
}

function renderWarningCount(card: Card): void {
  card.warningEmpty.hidden = card.warnings.size > 0
  card.warningCount.textContent = String(card.warnings.size)
  card.warningCount.classList.toggle('count-alert', card.warnings.size > 0)
}

/** Identical messages are shown once with a repeat count. */
function addWarning(card: Card, message: string, options: { kind?: 'warning' | 'error'; update?: boolean } = {}): void {
  const existing = card.warnings.get(message)
  if (existing !== undefined) {
    existing.count += 1
    existing.badge.textContent = `×${existing.count}`
    existing.badge.hidden = false
    // A message first seen at mount that comes back with new data is about the data, so it can go stale.
    existing.update ||= options.update === true
  } else {
    const badge = h('span', { class: 'repeat', text: '' })
    badge.hidden = true
    const item = h('li', { class: `warning warning-${options.kind ?? 'warning'}` }, h('span', { text: message }), badge)
    card.warningList.append(item)
    card.warnings.set(message, { count: 1, badge, item, update: options.update === true })
  }
  renderWarningCount(card)
}

/** Warnings about previously applied data go stale when new data is sent. */
function clearUpdateWarnings(card: Card): void {
  for (const [message, entry] of card.warnings) {
    if (!entry.update) continue
    entry.item.remove()
    card.warnings.delete(message)
  }
  renderWarningCount(card)
}

type EventEntry = {
  kind?: 'event' | 'link' | 'navigate'
  /** The frame the event came from, for cards with several. */
  device?: Device
  /** What the view sent with the event (SPEC D35). */
  payload?: Payload
}

/** Adds a line to the card's event log: an event (with its payload), a link not followed or a navigation. */
function addEvent(card: Card, name: string, time: number, entry: EventEntry = {}): void {
  card.events += 1
  card.eventCount.textContent = String(card.events)
  card.logEmpty.hidden = true
  const label =
    entry.kind === 'link'
      ? h('span', { class: 'event-link', text: `link not followed: ${name}` })
      : entry.kind === 'navigate'
        ? h('span', { class: 'event-navigate' }, h('code', { text: 'navigate' }), h('span', { class: 'event-link', text: ` → ${name}` }))
        : h('code', { text: name })
  // As text, never markup: a payload holds the data's own strings.
  const shown = entry.payload === undefined ? null : formatPayload(entry.payload)
  const payload = shown === null ? null : h('span', { class: 'event-payload', text: shown.text, title: shown.full })
  const where = entry.device === undefined ? null : h('span', { class: 'event-device', text: deviceName(entry.device) })
  const item = h('li', { class: 'event' }, h('time', { text: formatTime(new Date(time)) }), label, where, payload)
  card.log.prepend(item)
  item.classList.add('event-new')
  setTimeout(() => item.classList.remove('event-new'), 600)
}

function post(card: Card, message: unknown): void {
  for (const frame of card.frames) frame.iframe.contentWindow?.postMessage(message, location.origin)
}

function sendData(card: Card, data: Record<string, unknown>, frame?: Frame): void {
  clearUpdateWarnings(card)
  if (frame === undefined) post(card, setDataMessage(data))
  else frame.iframe.contentWindow?.postMessage(setDataMessage(data), location.origin)
}

function initialData(card: Card): Record<string, unknown> {
  return card.snapshot === null ? {} : card.snapshot.data
}

function onEditorInput(card: Card): void {
  clearTimeout(card.debounce)
  card.debounce = setTimeout(() => {
    const result = parseDataJson(card.editor.value)
    card.editedBadge.hidden = card.editor.value === formatData(initialData(card))
    if (!result.ok) {
      card.editor.classList.add('invalid')
      card.editor.setAttribute('aria-invalid', 'true')
      card.editorError.textContent = `Not applied: ${result.message}`
      card.editorError.hidden = false
      return
    }
    card.editor.classList.remove('invalid')
    card.editor.removeAttribute('aria-invalid')
    card.editorError.hidden = true
    sendData(card, result.data)
  }, 150)
}

/** The URL input a card's snapshot starts with (SPEC D27); `name` is the route the card previews. */
function initialRoute(card: Card): { name?: string; params: Record<string, string>; query: Record<string, string> } {
  const input = { params: { ...card.snapshot?.route?.params }, query: { ...card.snapshot?.route?.query } }
  return card.route === null ? input : { name: card.route.name, ...input }
}

function initialUrl(card: Card): string {
  if (card.route === null) return ''
  const { params, query } = initialRoute(card)
  return routeCardUrl(card.route.path, params, query, card.route.query)
}

/** Applies the URL typed in a route card's address bar: it must be a URL of the card's route. */
function onUrlChange(card: Card): void {
  const route = card.route
  if (route === null || card.urlInput === null || card.urlError === null) return
  let url: URL
  try {
    url = new URL(card.urlInput.value.trim() || '/', location.origin)
  } catch {
    url = new URL('/', location.origin)
  }
  const params = matchPath(route, url.pathname)
  const edited = card.urlInput.value !== initialUrl(card)
  card.editedBadge.hidden = !edited && card.editor.value === formatData(initialData(card))
  if (params === null) {
    card.urlInput.classList.add('invalid')
    card.urlInput.setAttribute('aria-invalid', 'true')
    card.urlError.textContent = `Not applied: not a URL of route '${route.name}' (${route.path})`
    card.urlError.hidden = false
    return
  }
  card.urlInput.classList.remove('invalid')
  card.urlInput.removeAttribute('aria-invalid')
  card.urlError.hidden = true
  const query: Record<string, string> = {}
  for (const name of route.query) {
    const value = url.searchParams.get(name)
    if (value !== null) query[name] = value
  }
  post(card, setRouteMessage({ name: route.name, params, query }))
}

function resetCard(card: Card): void {
  clearTimeout(card.debounce)
  if (card.urlInput !== null && card.urlError !== null) {
    card.urlInput.value = initialUrl(card)
    card.urlInput.classList.remove('invalid')
    card.urlInput.removeAttribute('aria-invalid')
    card.urlError.hidden = true
    post(card, setRouteMessage(initialRoute(card)))
  }
  card.editor.value = formatData(initialData(card))
  card.editor.classList.remove('invalid')
  card.editor.removeAttribute('aria-invalid')
  card.editorError.hidden = true
  card.editedBadge.hidden = true
  sendData(card, structuredClone(initialData(card)))
}

function panel(title: string, count: HTMLElement | null, open: boolean, ...body: Node[]): HTMLDetailsElement {
  const summary = h('summary', {}, h('span', { text: title }), count)
  const details = h('details', { class: 'panel' }, summary, ...body)
  details.open = open
  return details
}

/** In a comparison, cards sit in a grid: a column per version, a row per snapshot under the headers. */
function place(el: HTMLElement, column: number, row: number): void {
  el.style.gridColumn = String(column + 1)
  el.style.gridRow = String(row + 1)
}

function createCard(view: LoadedView, version: LoadedVersion, snapshot: Snapshot | null, compare: boolean): Card {
  const name = snapshot === null ? 'no data' : snapshot.name
  const several = state.devices.length > 1
  const frames: Frame[] = []
  const boxes = state.devices.map((device) => {
    const where = [compare ? versionLabel(version) : null, name, several ? deviceLabel(device) : null].filter((part) => part !== null).join(', ')
    const iframe = h('iframe', {
      title: `${version.title}: ${where}`,
      attrs: {
        src: frameUrl(version.entry.file, {
          snapshot: snapshot?.name ?? null,
          route: view.route?.name ?? null,
          alt: version.own ? version.alt : null,
          theme: version.own ? null : version.alt,
        }),
      },
    })
    const wrap = h('div', { class: 'frame-wrap' }, iframe)
    frames.push({ device, wrap, iframe, status: 'loading' })
    return h('div', { class: 'frame' }, several ? h('p', { class: 'frame-label', text: deviceLabel(device) }) : null, wrap)
  })
  // A route card has an address bar: the URL the snapshot shows, editable like the view's data.
  let urlInput: HTMLInputElement | null = null
  let urlError: HTMLElement | null = null
  let urlBar: HTMLElement | null = null
  if (view.route !== null) {
    urlInput = h('input', { class: 'url-input', attrs: { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': `URL for ${name}` } })
    urlError = h('p', { class: 'editor-error url-error', attrs: { id: `url-error-${++editorIds}` } })
    urlError.hidden = true
    urlInput.setAttribute('aria-describedby', urlError.id)
    urlBar = h('div', { class: 'url-bar', title: `Route '${view.route.name}': ${view.route.path}` }, h('span', { class: 'url-label', text: 'URL' }), urlInput)
  }
  const statusBadge = h('span', { class: 'status status-loading', text: 'loading' })
  const editedBadge = h('span', { class: 'edited', text: 'edited' })
  editedBadge.hidden = true

  // A snapshot that extends another (SPEC D30) says which; its editor shows the merged data.
  const base = snapshot?.extends === undefined ? null : h('span', { class: 'card-base', text: `extends ${snapshot.extends}`, title: `Builds on '${snapshot.extends}' and sets only what differs` })
  const head = h('header', { class: 'card-head' }, h('h2', { class: 'card-title', text: name, title: name }), base, statusBadge, h('span', { class: 'spacer' }))
  if (snapshot !== null && state.snapshot === null) {
    // In a comparison, alone means this version too.
    const changes: Partial<ShellState> = compare ? { snapshot: snapshot.name, alt: version.key } : { snapshot: snapshot.name }
    head.append(stateLink({ class: 'card-action', text: 'Open alone', title: 'Show only this snapshot (a URL for screenshots)' }, changes))
  }

  const editor = h('textarea', { class: 'editor', attrs: { spellcheck: 'false', autocomplete: 'off', 'aria-label': `Data for ${name}` } })
  editor.value = formatData(snapshot?.data ?? {})
  editor.rows = Math.min(14, Math.max(3, editor.value.split('\n').length))
  const editorError = h('p', { class: 'editor-error', attrs: { id: `editor-error-${++editorIds}` } })
  editorError.hidden = true
  editor.setAttribute('aria-describedby', editorError.id)
  const resetButton = h('button', { class: 'link-button', text: 'Reset', title: 'Back to the snapshot data', attrs: { type: 'button' } })

  const eventCount = h('span', { class: 'count', text: '0' })
  const log = h('ol', { class: 'log' })
  const logEmpty = h('p', { class: 'empty', text: version.events ? 'Click something that emits an event.' : 'Links you click show up here.' })
  const clearLog = h('button', { class: 'link-button', text: 'Clear', attrs: { type: 'button' } })

  const warningCount = h('span', { class: 'count', text: '0' })
  const warningList = h('ul', { class: 'warnings' })
  const warningEmpty = h('p', { class: 'empty', text: 'No warnings.' })

  // A comparison keeps the panels closed under the frames, so its columns stay as wide as the frames.
  const open = !compare
  const panels = h('aside', { class: 'panels' })
  // A static view (exploration, D28) has no data to edit.
  if (version.entry.stage !== 'exploration') panels.append(panel('State', editedBadge, open, editor, editorError, h('div', { class: 'panel-actions' }, resetButton)))
  panels.append(panel('Events', eventCount, open, logEmpty, log, h('div', { class: 'panel-actions' }, clearLog)))
  panels.append(panel('Warnings', warningCount, open, warningEmpty, warningList))

  const body = h('div', { class: 'card-body' }, h('div', { class: 'frames' }, ...boxes), panels)
  const root = h('section', { class: 'card' }, head, ...(urlBar === null || urlError === null ? [] : [urlBar, urlError]), body)
  const card: Card = {
    version,
    snapshot,
    route: view.route,
    frames,
    root,
    statusBadge,
    editor,
    editorError,
    editedBadge,
    urlInput,
    urlError,
    log,
    logEmpty,
    eventCount,
    warningList,
    warningEmpty,
    warningCount,
    warnings: new Map(),
    events: 0,
    debounce: undefined,
  }
  editor.addEventListener('input', () => onEditorInput(card))
  if (urlInput !== null) {
    urlInput.value = initialUrl(card)
    urlInput.addEventListener('change', () => onUrlChange(card))
    urlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') onUrlChange(card)
    })
  }
  resetButton.addEventListener('click', () => resetCard(card))
  clearLog.addEventListener('click', () => {
    card.log.replaceChildren()
    card.events = 0
    card.eventCount.textContent = '0'
    card.logEmpty.hidden = false
  })
  return card
}

/** A comparison column's header: the version, its file, its stage, its theme and why it exists. */
function versionHead(version: LoadedVersion, column: number): HTMLElement {
  const title = h('div', { class: 'version-title' }, h('strong', { text: version.alt ?? CURRENT_VERSION }))
  title.append(h('span', { class: `chip chip-${version.entry.stage}`, text: version.entry.stage, title: 'The stage the file is at (exploration, states or contracts)' }))
  if (version.alt !== null && version.theme) title.append(h('span', { class: 'chip chip-theme', text: version.own ? 'own theme' : 'theme only', title: `explore/${version.alt}/theme.css over the project's theme` }))
  title.append(h('span', { class: 'spacer' }), stateLink({ class: 'card-action', text: 'Open alone', title: 'Show only this version' }, { alt: version.key }))
  const file = version.own || version.alt === null ? versionPath(version) : `${version.entry.file} with explore/${version.alt}/theme.css`
  const head = h('header', { class: 'version-head' }, title, h('p', { class: 'version-file', text: file, title: file }))
  if (version.own && version.entry.description !== '') head.append(h('p', { class: 'version-description', text: version.entry.description }))
  place(head, column, 0)
  return head
}

function applyLayout(): void {
  canvas.style.setProperty('--zoom', String(state.zoom))
  for (const card of cards) {
    for (const { device, wrap, iframe } of card.frames) {
      // The wrapper takes the scaled size so cards lay out correctly; the iframe keeps the real
      // viewport size (responsive classes see the device width) and is scaled with a transform.
      wrap.style.width = `${device.width * state.zoom}px`
      wrap.style.height = `${device.height * state.zoom}px`
      iframe.style.width = `${device.width}px`
      iframe.style.height = `${device.height}px`
      iframe.style.transform = `scale(${state.zoom})`
    }
  }
}

function onFrameMessage(card: Card, frame: Frame, message: FrameMessage): void {
  const device = card.frames.length > 1 ? frame.device : undefined
  switch (message.type) {
    case 'ready': {
      setFrameStatus(card, frame, 'ready')
      // The frame (re)loaded with the snapshot's data: an edit made while it was loading, or before a
      // reload of the frame alone, would otherwise be lost while the editor still shows it.
      const edited = parseDataJson(card.editor.value)
      if (edited.ok && card.editor.value !== formatData(initialData(card))) sendData(card, edited.data, frame)
      break
    }
    case 'event':
      addEvent(card, message.name, message.time, { device, payload: message.payload })
      break
    case 'link': {
      // A link to one of the app's routes is a navigation (SPEC D25): logged, not followed.
      const internal = message.href.startsWith('/') && !message.href.startsWith('//')
      const match = internal ? matchRoute({ routes: routesEntry.routes }, message.href) : null
      if (match === null) addEvent(card, message.href, message.time, { kind: 'link', device })
      else addEvent(card, `${match.route.name} ${match.url}`, message.time, { kind: 'navigate', device })
      break
    }
    case 'warning':
      // Every frame of a card renders the same data, so they warn alike: the first one speaks for all.
      if (frame === card.frames[0]) addWarning(card, message.message, { update: message.update })
      break
    case 'error':
      addWarning(card, message.message, { kind: 'error' })
      setFrameStatus(card, frame, 'error')
      break
  }
}

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || !isFrameMessage(event.data)) return
  for (const card of cards) {
    const frame = card.frames.find((item) => item.iframe.contentWindow === event.source)
    if (frame !== undefined) return onFrameMessage(card, frame, event.data)
  }
})

// ---------------------------------------------------------------------------------------------------
// Loading

async function fetchJson<T>(path: string, what: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' })
  if (!response.ok) throw new Error(`couldn't list ${what}: HTTP ${response.status}`)
  return (await response.json()) as T
}

/**
 * What the URL asks for: a route's page or a view, with every version of it. When it asks for neither,
 * the first route, else the first view, else the first screen in explore/. Undefined when it names a
 * route or view that doesn't exist.
 */
function pickView(): { name: string; route: Route | null; all: VersionEntry[] } | undefined {
  const pick = (name: string, route: Route | null) => {
    const all = versionsOf(name)
    return all.length === 0 ? undefined : { name, route, all }
  }
  const routed = (route: Route | undefined) => (route === undefined ? undefined : pick(route.view, route))
  if (state.route !== null) return routed(routesEntry.routes.find((route) => route.name === state.route))
  if (state.view !== null) return pick(state.view, null)
  const first = routed(routesEntry.routes[0]) ?? (views[0] === undefined ? undefined : pick(views[0].name, null))
  const exploring = exploringNames()[0]
  return first ?? (exploring === undefined ? undefined : pick(exploring, null))
}

function renderCards(view: LoadedView): HTMLElement[] {
  const extra: HTMLElement[] = []
  const compare = view.versions.length > 1
  let rows = snapshotRows(view.versions.map((version) => version.snapshots.map((snapshot) => snapshot.name)))
  // With no version to show (an unknown alternative, already reported), no snapshot can be found either.
  if (state.snapshot !== null && view.versions.length > 0) {
    const wanted = state.snapshot
    if (!rows.includes(wanted)) {
      const names = rows.filter((row) => row !== null).map((row) => `'${row}'`).join(', ') || 'none'
      const lines = [`Snapshots: ${names}`]
      if (view.versions.some((version) => version.issues.some((issue) => issue.path?.startsWith('snapshots')))) lines.push('The snapshots block has problems; see above.')
      const files = view.versions.length === 1 ? versionPath(view.versions[0]!) : view.name
      extra.push(notice('error', `${files} has no snapshot named '${wanted}'`, lines, { text: 'Show all snapshots', changes: { snapshot: null } }))
      loadFailed = true
      rows = []
    } else {
      rows = [wanted]
      if (state.chrome) extra.push(notice('info', `Showing only '${wanted}'`, [], { text: 'Show all snapshots', changes: { snapshot: null } }))
    }
  }
  cards = []
  const nodes: HTMLElement[] = []
  view.versions.forEach((version, column) => {
    if (compare) nodes.push(versionHead(version, column))
    rows.forEach((row, index) => {
      const snapshot = row === null ? null : version.snapshots.find((item) => item.name === row)
      // A version without snapshots shows once, in the first row; one that lacks this snapshot says so.
      if ((row === null) !== (version.snapshots.length === 0) || snapshot === undefined) {
        if (compare && row !== null && version.snapshots.length > 0) {
          const empty = h('div', { class: 'cell-empty', text: `No snapshot '${row}' in ${versionPath(version)}` })
          place(empty, column, index + 1)
          nodes.push(empty)
        }
        return
      }
      const card = createCard(view, version, snapshot, compare)
      if (compare) place(card.root, column, index + 1)
      cards.push(card)
      nodes.push(card.root)
    })
  })
  canvas.replaceChildren(...nodes)
  canvas.classList.toggle('compare', compare)
  canvas.style.gridTemplateColumns = compare ? `repeat(${view.versions.length}, max-content)` : ''
  canvas.classList.toggle('single', cards.length === 1)
  applyLayout()
  // With cards, the attribute waits for their frames.
  markReady()
  return extra
}

/** `nap` when there's simply nothing to show yet, `oops` when something went wrong. */
function emptyState(title: string, text: string, mood: 'nap' | 'oops' = 'oops'): void {
  loaded = null
  cards = []
  const zin = h('img', { class: 'empty-zin', attrs: { src: mood === 'nap' ? zinSoneca : zinOps, alt: '' } })
  canvas.classList.remove('compare')
  canvas.style.gridTemplateColumns = ''
  canvas.replaceChildren(h('div', { class: 'empty-state' }, zin, h('h2', { text: title }), h('p', { text })))
  viewMeta.textContent = ''
  renderAltPicker()
}

/** Notices about URL parameters the shell couldn't use. */
function urlNotices(): HTMLElement[] {
  const device = new URLSearchParams(location.search).get('device')
  if (device === null || parseDevices(device) !== null) return []
  const hint = `Use WxH with each side from ${DEVICE_MIN} to ${DEVICE_MAX}, or phone, tablet, desktop; separate several with commas (phone,desktop).`
  return [notice('warning', `Ignored device '${device}'; showing ${devicesLabel(state.devices)}`, [hint])]
}

/** Fetches a version's file; versions that show the same file share one request. */
function fetchVersionHtml(version: VersionEntry, requests: Map<string, Promise<string>>): Promise<string> {
  const url = viewFileUrl(version.entry.file, version.own ? version.alt : null)
  let request = requests.get(url)
  if (request === undefined) {
    request = fetch(url, { cache: 'no-store' }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.text()
    })
    requests.set(url, request)
  }
  return request
}

async function loadCurrentView(): Promise<void> {
  const token = ++loadToken
  delete document.body.dataset.melzinReady
  stateLinks = []
  loadFailed = false
  const picked = pickView()
  const pageNotices: HTMLElement[] = urlNotices()
  if (routesEntry.problems.length > 0) {
    const count = plural(routesEntry.problems.length, 'problem')
    pageNotices.push(notice('error', `routes.json: ${count}, so the shell lists no pages (run melzin check)`, routesEntry.problems))
  }
  if (explore.problems.length > 0) {
    const count = plural(explore.problems.length, 'file')
    pageNotices.push(notice('warning', `explore/: ${count} can't be an alternative, so the shell leaves them out (run melzin check)`, explore.problems))
  }
  if (picked === undefined) {
    // Keep the requested name in the URL: once the file exists, a refresh shows it (D3).
    const missing = missingPage(state, [...views.map((view) => view.name), ...exploringNames()], routesEntry.routes)
    emptyState(missing.title, missing.text, missing.mood)
    loadFailed = missing.failed
    viewPicker.value = ''
    notices.replaceChildren(...pageNotices)
    markReady()
    return
  }
  const { name, route, all } = picked
  state.route = route?.name ?? null
  state.view = route === null ? name : null
  updateUrl()

  // The versions the URL asks for: all of them, or one (SPEC D31).
  let shown = all
  if (state.alt !== null) {
    const match = all.find((version) => version.key === state.alt)
    if (match === undefined) {
      const keys = all.map((version) => `'${version.key}'`).join(', ')
      pageNotices.push(notice('error', `'${name}' has no version named '${state.alt}'`, [`Versions: ${keys}`], { text: 'Show all versions', changes: { alt: null } }))
      loadFailed = true
      shown = []
    } else {
      shown = [match]
      if (state.chrome && all.length > 1) pageNotices.push(notice('info', `Showing only ${match.alt === null ? 'the version in views/' : `the alternative '${match.alt}'`}`, [], { text: 'Show all versions', changes: { alt: null } }))
    }
  }

  const requests = new Map<string, Promise<string>>()
  const results = await Promise.all(
    shown.map(async (version) => {
      try {
        return { version, html: await fetchVersionHtml(version, requests) }
      } catch (error) {
        return { version, error: error instanceof Error ? error.message : String(error) }
      }
    }),
  )
  if (token !== loadToken) return

  const versions: LoadedVersion[] = []
  for (const result of results) {
    if (result.html === undefined) {
      loadFailed = true
      pageNotices.push(notice('error', `Couldn't load ${versionPath(result.version)}`, [result.error ?? '']))
      continue
    }
    const parsed = parseViewHtml(result.html)
    const events = Object.keys(parsed.schema?.events ?? {}).length > 0
    versions.push({ ...result.version, title: parsed.title || result.version.entry.name, snapshots: parsed.snapshots, issues: parsed.issues, events })
  }
  loaded = { name, route, all, versions }
  renderAltPicker()
  viewPicker.value = currentPickerValue()
  const title = versions[0]?.title ?? all[0]?.entry.title ?? name
  document.title = `${route === null ? title : route.path} · Melzin shell`
  const page = route === null ? '' : `${route.path} (route '${route.name}') · `
  if (versions.length === 1) {
    const only = versions[0]!
    const count = only.snapshots.length
    viewMeta.textContent = `${page}${versionPath(only)} · ${only.entry.stage} · ${count === 0 ? 'no snapshots' : plural(count, 'snapshot')}`
  } else {
    viewMeta.textContent = `${page}${name} · ${plural(all.length, 'version')}`
  }
  if (versions.length === 0 && shown.length > 0) {
    emptyState(`Couldn't load ${name}`, 'Fix the problem above, then reload.')
    notices.replaceChildren(...pageNotices)
    document.body.dataset.melzinReady = 'error'
    return
  }
  // Shown even with chrome=0: a screenshot of a view with a broken schema or snapshots would mislead.
  const reported = new Set<string>()
  for (const version of versions) {
    const path = versionPath(version)
    if (version.issues.length === 0 || reported.has(path)) continue
    reported.add(path)
    const count = plural(version.issues.length, 'problem')
    pageNotices.push(notice('error', `${path}: ${count} in the schema or snapshots blocks (run melzin check for every problem, with positions)`, version.issues.map(issueLine)))
  }
  pageNotices.push(...renderCards(loaded))
  notices.replaceChildren(...pageNotices)
}

async function reloadAll(): Promise<void> {
  try {
    ;[views, routesEntry, explore] = await Promise.all([
      fetchJson<ViewEntry[]>('/__melzin/api/views', 'views'),
      fetchJson<RoutesEntry>('/__melzin/api/routes', 'routes'),
      fetchJson<ExploreEntry>('/__melzin/api/explore', 'alternatives'),
    ])
  } catch (error) {
    views = []
    routesEntry = { present: false, routes: [], problems: [] }
    explore = { alternatives: [], problems: [] }
    notices.replaceChildren(notice('error', 'The shell server is unreachable', [error instanceof Error ? error.message : String(error)]))
    emptyState('No connection', 'Start melzin shell again, then reload.')
    renderViewPicker()
    document.body.dataset.melzinReady = 'error'
    return
  }
  loaded = null
  await loadCurrentView()
  renderViewPicker()
}

document.body.classList.toggle('chrome-off', !state.chrome)
renderDevicePicker()
renderZoomPicker()
void reloadAll()
