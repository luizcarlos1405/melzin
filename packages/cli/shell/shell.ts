// The preview shell: lists the project's views, renders one frame per snapshot at a device size and
// zoom, and plays the mock host's UI for each frame (state editor, event log, warnings). All state
// worth sharing lives in the URL (see state.ts), so a refresh reloads everything from the files (D3).

import { type Issue, type Snapshot, parseViewHtml } from 'melzin'
import { type FrameMessage, isFrameMessage, setDataMessage } from './protocol.ts'
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
  serializeShellState,
  stepZoom,
  viewFileUrl,
  zoomLabel,
} from './state.ts'
// Zin, the Melzin bee. Bun's bundler turns these imports into asset URLs.
import zinOps from './zin-ops.svg'
import zinSoneca from './zin-soneca.svg'

type ViewEntry = { name: string; file: string; url: string; title: string }

type LoadedView = { entry: ViewEntry; title: string; snapshots: Snapshot[]; issues: Issue[] }

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

function renderViewPicker(): void {
  if (views.length === 0) {
    viewPicker.replaceChildren(h('option', { text: 'No views', attrs: { value: '' } }))
    viewPicker.disabled = true
    return
  }
  viewPicker.disabled = false
  const titles = new Map<string, number>()
  for (const view of views) titles.set(view.title, (titles.get(view.title) ?? 0) + 1)
  viewPicker.replaceChildren(
    ...views.map((view) => {
      const label = (titles.get(view.title) ?? 0) > 1 ? `${view.title} (${view.file})` : view.title
      return h('option', { text: label, title: view.file, attrs: { value: view.name } })
    }),
  )
  // The requested view even when its file failed to load; blank for a name that matches no view.
  viewPicker.value = current?.entry.name ?? pickView()?.name ?? ''
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
  state.view = viewPicker.value
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

function addEvent(card: Card, name: string, time: number, kind: 'event' | 'link' = 'event'): void {
  card.events += 1
  card.eventCount.textContent = String(card.events)
  card.logEmpty.hidden = true
  const label = kind === 'link' ? h('span', { class: 'event-link', text: `link not followed: ${name}` }) : h('code', { text: name })
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

function resetCard(card: Card): void {
  clearTimeout(card.debounce)
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
    attrs: { src: frameUrl(view.entry.file, snapshot?.name ?? null) },
  })
  const wrap = h('div', { class: 'frame-wrap' }, iframe)
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

  const root = h('section', { class: 'card' }, head, h('div', { class: 'card-body' }, wrap, panels))
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
    case 'link':
      addEvent(card, message.href, message.time, 'link')
      break
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

async function fetchViews(): Promise<ViewEntry[]> {
  const response = await fetch('/__melzin/api/views', { cache: 'no-store' })
  if (!response.ok) throw new Error(`couldn't list views: HTTP ${response.status}`)
  return (await response.json()) as ViewEntry[]
}

/** The view the URL asks for (the first one when it asks for none); undefined when it names a missing view. */
function pickView(): ViewEntry | undefined {
  const wanted = state.view
  if (wanted === null) return views[0]
  return views.find((view) => view.name === wanted || view.file === wanted)
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
  const entry = pickView()
  const pageNotices: HTMLElement[] = urlNotices()
  if (entry === undefined) {
    // Keep the requested name in the URL: once the file exists, a refresh shows it (D3).
    if (views.length === 0) emptyState('No views yet', 'Add a *.mel.html file to the views folder, then reload.', 'nap')
    else emptyState(`No view named '${state.view}'`, `Available: ${views.map((view) => view.name).join(', ')}. Pick one above, or add the file and reload.`)
    viewPicker.value = ''
    notices.replaceChildren(...pageNotices)
    document.body.dataset.melzinReady = 'true'
    return
  }
  state.view = entry.name
  updateUrl()
  viewPicker.value = entry.name

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
  current = { entry, title: parsed.title || entry.name, snapshots: parsed.snapshots, issues: parsed.issues }
  document.title = `${current.title} · Melzin shell`
  viewPicker.value = entry.name
  const count = parsed.snapshots.length
  viewMeta.textContent = `${entry.file} · ${count === 0 ? 'no snapshots' : `${count} snapshot${count === 1 ? '' : 's'}`}`
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
    views = await fetchViews()
  } catch (error) {
    views = []
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
