// The preview shell: lists the project's routes (as pages, SPEC D26) and views, renders one frame per
// snapshot at a device size and zoom, and plays the mock host's UI for each frame (state editor, URL,
// event log, warnings). All state worth sharing lives in the URL (see state.ts), so a refresh reloads
// everything from the files (D3).

import { type Issue, type Route, type Snapshot, parseViewHtml } from 'melzin'
import { matchPath, matchRoute } from 'melzin/core'
import { type FrameMessage, isFrameMessage, setDataMessage, setRouteMessage } from './protocol.ts'
import {
  DEVICE_MAX,
  DEVICE_MIN,
  DEVICE_PRESETS,
  type Device,
  type ShellState,
  ZOOM_STEPS,
  deviceLabel,
  findPreset,
  formatData,
  formatDevice,
  formatTime,
  frameUrl,
  parseDataJson,
  parseDevice,
  parseShellState,
  routeCardUrl,
  serializeShellState,
  stepZoom,
  viewFileUrl,
  zoomLabel,
} from './state.ts'
// Zin, the Melzin bee. Bun's bundler turns these imports into asset URLs.
import zinOps from './zin-ops.svg'
import zinSoneca from './zin-soneca.svg'

type ViewEntry = { name: string; file: string; url: string; title: string }
type RoutesEntry = { present: boolean; routes: Route[]; problems: string[] }

/** `route` is set when the view shows as that route's page. */
type LoadedView = { entry: ViewEntry; route: Route | null; title: string; snapshots: Snapshot[]; issues: Issue[] }

type WarningEntry = { count: number; badge: HTMLElement; item: HTMLLIElement; update: boolean }

type CardStatus = 'loading' | 'ready' | 'error'

type Card = {
  /** null for the single card of a view without snapshots. */
  snapshot: Snapshot | null
  root: HTMLElement
  wrap: HTMLElement
  iframe: HTMLIFrameElement
  status: CardStatus
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
let routesEntry: RoutesEntry = { present: false, routes: [], problems: [] }
let current: LoadedView | null = null
let cards: Card[] = []
let loadToken = 0
let editorIds = 0
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
// Top bar

function renderDevicePicker(): void {
  const options = DEVICE_PRESETS.map((preset) => h('option', { text: deviceLabel(preset), attrs: { value: formatDevice(preset) } }))
  if (findPreset(state.device) === undefined) {
    options.push(h('option', { text: deviceLabel(state.device), attrs: { value: formatDevice(state.device) } }))
  }
  devicePicker.replaceChildren(...options)
  devicePicker.value = formatDevice(state.device)
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
  const view = current?.entry.name ?? pickView()?.entry.name
  return view === undefined ? '' : pickerValue('view', view)
}

function renderViewPicker(): void {
  if (views.length === 0) {
    viewPicker.replaceChildren(h('option', { text: 'No views', attrs: { value: '' } }))
    viewPicker.disabled = true
    return
  }
  viewPicker.disabled = false
  const titles = new Map<string, number>()
  for (const view of views) titles.set(view.title, (titles.get(view.title) ?? 0) + 1)
  const viewOptions = views.map((view) => {
    const label = (titles.get(view.title) ?? 0) > 1 ? `${view.title} (${view.file})` : view.title
    return h('option', { text: label, title: view.file, attrs: { value: pickerValue('view', view.name) } })
  })
  const { routes } = routesEntry
  if (routes.length === 0) {
    viewPicker.replaceChildren(...viewOptions)
  } else {
    const routeOptions = routes.map((route) => h('option', { text: `${route.path}  (${route.name})`, title: `${route.view}.mel.html`, attrs: { value: pickerValue('route', route.name) } }))
    viewPicker.replaceChildren(h('optgroup', { attrs: { label: 'Pages' } }, ...routeOptions), h('optgroup', { attrs: { label: 'Views' } }, ...viewOptions))
  }
  // The requested view even when its file failed to load; blank for a name that matches nothing.
  viewPicker.value = currentPickerValue()
}

function setDevice(device: Device): void {
  state.device = device
  renderDevicePicker()
  applyLayout()
  updateUrl()
}

function setZoom(zoom: number): void {
  state.zoom = zoom
  renderZoomPicker()
  applyLayout()
  updateUrl()
}

devicePicker.addEventListener('change', () => {
  const device = parseDevice(devicePicker.value)
  if (device !== null) setDevice(device)
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

function cardName(card: Card): string {
  return card.snapshot === null ? 'no data' : card.snapshot.name
}

function setStatus(card: Card, status: CardStatus): void {
  card.status = status
  card.statusBadge.className = `status status-${status}`
  card.statusBadge.textContent = status === 'loading' ? 'loading' : status === 'ready' ? 'live' : 'error'
  if (cards.length > 0 && cards.every((item) => item.status !== 'loading')) document.body.dataset.melzinReady = 'true'
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

function addEvent(card: Card, name: string, time: number, kind: 'event' | 'link' | 'navigate' = 'event'): void {
  card.events += 1
  card.eventCount.textContent = String(card.events)
  card.logEmpty.hidden = true
  const label =
    kind === 'link'
      ? h('span', { class: 'event-link', text: `link not followed: ${name}` })
      : kind === 'navigate'
        ? h('span', { class: 'event-navigate' }, h('code', { text: 'navigate' }), h('span', { class: 'event-link', text: ` → ${name}` }))
        : h('code', { text: name })
  const item = h('li', { class: 'event' }, h('time', { text: formatTime(new Date(time)) }), label)
  card.log.prepend(item)
  item.classList.add('event-new')
  setTimeout(() => item.classList.remove('event-new'), 600)
}

function sendData(card: Card, data: Record<string, unknown>): void {
  clearUpdateWarnings(card)
  card.iframe.contentWindow?.postMessage(setDataMessage(data), location.origin)
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
  const route = current?.route ?? null
  const input = { params: { ...card.snapshot?.route?.params }, query: { ...card.snapshot?.route?.query } }
  return route === null ? input : { name: route.name, ...input }
}

function initialUrl(card: Card): string {
  const route = current?.route
  if (route == null) return ''
  const { params, query } = initialRoute(card)
  return routeCardUrl(route.path, params, query, route.query)
}

/** Applies the URL typed in a route card's address bar: it must be a URL of the card's route. */
function onUrlChange(card: Card): void {
  const route = current?.route
  if (route == null || card.urlInput === null || card.urlError === null) return
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
  card.iframe.contentWindow?.postMessage(setRouteMessage({ name: route.name, params, query }), location.origin)
}

function resetCard(card: Card): void {
  clearTimeout(card.debounce)
  if (card.urlInput !== null && card.urlError !== null) {
    card.urlInput.value = initialUrl(card)
    card.urlInput.classList.remove('invalid')
    card.urlInput.removeAttribute('aria-invalid')
    card.urlError.hidden = true
    card.iframe.contentWindow?.postMessage(setRouteMessage(initialRoute(card)), location.origin)
  }
  card.editor.value = formatData(initialData(card))
  card.editor.classList.remove('invalid')
  card.editor.removeAttribute('aria-invalid')
  card.editorError.hidden = true
  card.editedBadge.hidden = true
  sendData(card, structuredClone(initialData(card)))
}

function panel(title: string, count: HTMLElement | null, ...body: Node[]): HTMLDetailsElement {
  const summary = h('summary', {}, h('span', { text: title }), count)
  const details = h('details', { class: 'panel' }, summary, ...body)
  details.open = true
  return details
}

function createCard(view: LoadedView, snapshot: Snapshot | null): Card {
  const iframe = h('iframe', {
    title: `${view.title}: ${snapshot === null ? 'no data' : snapshot.name}`,
    attrs: { src: frameUrl(view.entry.file, snapshot?.name ?? null, view.route?.name ?? null) },
  })
  const wrap = h('div', { class: 'frame-wrap' }, iframe)
  // A route card has an address bar: the URL the snapshot shows, editable like the view's data.
  let urlInput: HTMLInputElement | null = null
  let urlError: HTMLElement | null = null
  let urlBar: HTMLElement | null = null
  if (view.route !== null) {
    urlInput = h('input', { class: 'url-input', attrs: { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': `URL for ${snapshot?.name ?? 'no data'}` } })
    urlError = h('p', { class: 'editor-error url-error', attrs: { id: `url-error-${++editorIds}` } })
    urlError.hidden = true
    urlInput.setAttribute('aria-describedby', urlError.id)
    urlBar = h('div', { class: 'url-bar', title: `Route '${view.route.name}': ${view.route.path}` }, h('span', { class: 'url-label', text: 'URL' }), urlInput)
  }
  const statusBadge = h('span', { class: 'status status-loading', text: 'loading' })
  const editedBadge = h('span', { class: 'edited', text: 'edited' })
  editedBadge.hidden = true

  const name = snapshot === null ? 'no data' : snapshot.name
  const head = h(
    'header',
    { class: 'card-head' },
    h('h2', { class: 'card-title', text: name, title: name }),
    statusBadge,
    h('span', { class: 'spacer' }),
  )
  if (snapshot !== null && state.snapshot === null) {
    head.append(stateLink({ class: 'card-action', text: 'Open alone', title: 'Show only this snapshot (a URL for screenshots)' }, { snapshot: snapshot.name }))
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
  const logEmpty = h('p', { class: 'empty', text: 'Click something that emits an event.' })
  const clearLog = h('button', { class: 'link-button', text: 'Clear', attrs: { type: 'button' } })

  const warningCount = h('span', { class: 'count', text: '0' })
  const warningList = h('ul', { class: 'warnings' })
  const warningEmpty = h('p', { class: 'empty', text: 'No warnings.' })

  const statePanel = panel('State', editedBadge, editor, editorError, h('div', { class: 'panel-actions' }, resetButton))
  const eventsPanel = panel('Events', eventCount, logEmpty, log, h('div', { class: 'panel-actions' }, clearLog))
  const warningsPanel = panel('Warnings', warningCount, warningEmpty, warningList)
  const panels = h('aside', { class: 'panels' }, statePanel, eventsPanel, warningsPanel)

  const root = h('section', { class: 'card' }, head, ...(urlBar === null || urlError === null ? [] : [urlBar, urlError]), h('div', { class: 'card-body' }, wrap, panels))
  const card: Card = {
    snapshot,
    root,
    wrap,
    iframe,
    status: 'loading',
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

function applyLayout(): void {
  const { width, height } = state.device
  canvas.style.setProperty('--device-width', `${width}px`)
  canvas.style.setProperty('--device-height', `${height}px`)
  canvas.style.setProperty('--zoom', String(state.zoom))
  for (const card of cards) {
    // The wrapper takes the scaled size so cards lay out correctly; the iframe keeps the real
    // viewport size (responsive classes see the device width) and is scaled with a transform.
    card.wrap.style.width = `${width * state.zoom}px`
    card.wrap.style.height = `${height * state.zoom}px`
    card.iframe.style.width = `${width}px`
    card.iframe.style.height = `${height}px`
    card.iframe.style.transform = `scale(${state.zoom})`
  }
}

function onFrameMessage(card: Card, message: FrameMessage): void {
  switch (message.type) {
    case 'ready': {
      setStatus(card, 'ready')
      // The frame (re)loaded with the snapshot's data: an edit made while it was loading, or before a
      // reload of the frame alone, would otherwise be lost while the editor still shows it.
      const edited = parseDataJson(card.editor.value)
      if (edited.ok && card.editor.value !== formatData(initialData(card))) sendData(card, edited.data)
      break
    }
    case 'event':
      addEvent(card, message.name, message.time)
      break
    case 'link': {
      // A link to one of the app's routes is a navigation (SPEC D25): logged, not followed.
      const internal = message.href.startsWith('/') && !message.href.startsWith('//')
      const match = internal ? matchRoute({ routes: routesEntry.routes }, message.href) : null
      if (match === null) addEvent(card, message.href, message.time, 'link')
      else addEvent(card, `${match.route.name} ${match.url}`, message.time, 'navigate')
      break
    }
    case 'warning':
      addWarning(card, message.message, { update: message.update })
      break
    case 'error':
      addWarning(card, message.message, { kind: 'error' })
      setStatus(card, 'error')
      break
  }
}

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || !isFrameMessage(event.data)) return
  const card = cards.find((item) => item.iframe.contentWindow === event.source)
  if (card !== undefined) onFrameMessage(card, event.data)
})

// ---------------------------------------------------------------------------------------------------
// Loading

async function fetchRoutes(): Promise<RoutesEntry> {
  const response = await fetch('/__melzin/api/routes', { cache: 'no-store' })
  if (!response.ok) throw new Error(`couldn't list routes: HTTP ${response.status}`)
  return (await response.json()) as RoutesEntry
}

async function fetchViews(): Promise<ViewEntry[]> {
  const response = await fetch('/__melzin/api/views', { cache: 'no-store' })
  if (!response.ok) throw new Error(`couldn't list views: HTTP ${response.status}`)
  return (await response.json()) as ViewEntry[]
}

/**
 * What the URL asks for: a route's page or a view. When it asks for neither, the first route, else the
 * first view. Undefined when it names a route or view that doesn't exist.
 */
function pickView(): { entry: ViewEntry; route: Route | null } | undefined {
  const viewEntry = (name: string): ViewEntry | undefined => views.find((view) => view.name === name || view.file === name)
  const routeEntry = (route: Route | undefined): { entry: ViewEntry; route: Route } | undefined => {
    const entry = route === undefined ? undefined : viewEntry(route.view)
    return route === undefined || entry === undefined ? undefined : { entry, route }
  }
  if (state.route !== null) return routeEntry(routesEntry.routes.find((route) => route.name === state.route))
  if (state.view !== null) {
    const entry = viewEntry(state.view)
    return entry === undefined ? undefined : { entry, route: null }
  }
  const first = routeEntry(routesEntry.routes[0])
  if (first !== undefined) return first
  return views[0] === undefined ? undefined : { entry: views[0], route: null }
}

function renderCards(view: LoadedView): HTMLElement[] {
  const extra: HTMLElement[] = []
  let snapshots: (Snapshot | null)[] = view.snapshots.length > 0 ? view.snapshots : [null]
  if (state.snapshot !== null) {
    const wanted = state.snapshot
    const match = view.snapshots.find((snapshot) => snapshot.name === wanted)
    if (match === undefined) {
      const names = view.snapshots.map((snapshot) => `'${snapshot.name}'`).join(', ') || 'none'
      const lines = [`Snapshots: ${names}`]
      if (view.issues.some((issue) => issue.path?.startsWith('snapshots'))) lines.push('The snapshots block has problems; see above.')
      extra.push(notice('error', `${view.entry.file} has no snapshot named '${wanted}'`, lines, { text: 'Show all snapshots', changes: { snapshot: null } }))
      snapshots = []
    } else {
      snapshots = [match]
      if (state.chrome) extra.push(notice('info', `Showing only '${wanted}'`, [], { text: 'Show all snapshots', changes: { snapshot: null } }))
    }
  }
  cards = snapshots.map((snapshot) => createCard(view, snapshot))
  canvas.replaceChildren(...cards.map((card) => card.root))
  canvas.classList.toggle('single', cards.length === 1)
  applyLayout()
  if (cards.length === 0) document.body.dataset.melzinReady = 'true'
  return extra
}

/** `nap` when there's simply nothing to show yet, `oops` when something went wrong. */
function emptyState(title: string, text: string, mood: 'nap' | 'oops' = 'oops'): void {
  current = null
  cards = []
  const zin = h('img', { class: 'empty-zin', attrs: { src: mood === 'nap' ? zinSoneca : zinOps, alt: '' } })
  canvas.replaceChildren(h('div', { class: 'empty-state' }, zin, h('h2', { text: title }), h('p', { text })))
  viewMeta.textContent = ''
}

/** Notices about URL parameters the shell couldn't use. */
function urlNotices(): HTMLElement[] {
  const device = new URLSearchParams(location.search).get('device')
  if (device === null || parseDevice(device) !== null) return []
  return [notice('warning', `Ignored device '${device}'; showing ${deviceLabel(state.device)}`, [`Use WxH with each side from ${DEVICE_MIN} to ${DEVICE_MAX}, or phone, tablet, desktop.`])]
}

async function loadCurrentView(): Promise<void> {
  const token = ++loadToken
  delete document.body.dataset.melzinReady
  stateLinks = []
  const picked = pickView()
  const pageNotices: HTMLElement[] = urlNotices()
  if (routesEntry.problems.length > 0) {
    const count = `${routesEntry.problems.length} problem${routesEntry.problems.length === 1 ? '' : 's'}`
    pageNotices.push(notice('error', `routes.json: ${count}, so the shell lists no pages (run melzin check)`, routesEntry.problems))
  }
  if (picked === undefined) {
    // Keep the requested name in the URL: once the file exists, a refresh shows it (D3).
    if (views.length === 0) {
      emptyState('No views yet', 'Add a *.mel.html file to the views folder, then reload.', 'nap')
    } else if (state.route !== null) {
      const route = routesEntry.routes.find((item) => item.name === state.route)
      const pages = routesEntry.routes.map((item) => item.name).join(', ') || 'none'
      if (route === undefined) emptyState(`No route named '${state.route}'`, `Routes: ${pages}. Pick a page or a view above.`)
      else emptyState(`Route '${route.name}' shows '${route.view}', which isn't in the views folder`, 'Add the view, or fix routes.json, then reload.')
    } else {
      emptyState(`No view named '${state.view}'`, `Available: ${views.map((view) => view.name).join(', ')}. Pick one above, or add the file and reload.`)
    }
    viewPicker.value = ''
    notices.replaceChildren(...pageNotices)
    document.body.dataset.melzinReady = 'true'
    return
  }
  const { entry, route } = picked
  state.route = route?.name ?? null
  state.view = route === null ? entry.name : null
  updateUrl()
  viewPicker.value = currentPickerValue()

  let html: string
  try {
    const response = await fetch(viewFileUrl(entry.file), { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    html = await response.text()
  } catch (error) {
    if (token !== loadToken) return
    notices.replaceChildren(...pageNotices, notice('error', `Couldn't load ${entry.file}`, [error instanceof Error ? error.message : String(error)]))
    emptyState(`Couldn't load ${entry.file}`, 'Fix the problem above, then reload.')
    document.body.dataset.melzinReady = 'error'
    return
  }
  if (token !== loadToken) return

  const parsed = parseViewHtml(html)
  current = { entry, route, title: parsed.title || entry.name, snapshots: parsed.snapshots, issues: parsed.issues }
  document.title = `${route === null ? current.title : route.path} · Melzin shell`
  viewPicker.value = currentPickerValue()
  const count = parsed.snapshots.length
  const page = route === null ? '' : `${route.path} (route '${route.name}') · `
  viewMeta.textContent = `${page}${entry.file} · ${count === 0 ? 'no snapshots' : `${count} snapshot${count === 1 ? '' : 's'}`}`
  // Shown even with chrome=0: a screenshot of a view with a broken schema or snapshots would mislead.
  if (parsed.issues.length > 0) {
    const count = `${parsed.issues.length} problem${parsed.issues.length === 1 ? '' : 's'}`
    pageNotices.push(notice('error', `${entry.file}: ${count} in the schema or snapshots blocks (run melzin check for every problem, with positions)`, parsed.issues.map(issueLine)))
  }
  pageNotices.push(...renderCards(current))
  notices.replaceChildren(...pageNotices)
}

async function reloadAll(): Promise<void> {
  try {
    ;[views, routesEntry] = await Promise.all([fetchViews(), fetchRoutes()])
  } catch (error) {
    views = []
    routesEntry = { present: false, routes: [], problems: [] }
    notices.replaceChildren(notice('error', 'The shell server is unreachable', [error instanceof Error ? error.message : String(error)]))
    emptyState('No connection', 'Start melzin shell again, then reload.')
    renderViewPicker()
    document.body.dataset.melzinReady = 'error'
    return
  }
  current = null
  await loadCurrentView()
  renderViewPicker()
}

document.body.classList.toggle('chrome-off', !state.chrome)
renderDevicePicker()
renderZoomPicker()
void reloadAll()
