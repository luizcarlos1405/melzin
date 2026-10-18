// One render of one view: `/frame?view=counter.mel.html&snapshot=zero`. The frame is the view's
// mock host. It mounts the view through the real runtime with the snapshot's data, gives it a
// handler for every declared event, and reports events and warnings to the shell. The shell sends
// new data with a "set-data" message, applied with `view.update`.

import { type RouteInput, VIEW_FILE_SUFFIX } from 'melzin/core'
import { DATA_WARNING_PREFIX, type MelzinView, mountSource, parseViewHtml } from 'melzin'
import { type FrameMessageBody, frameMessage, isShellMessage } from './protocol.ts'
import { viewFileName, viewFileUrl } from './state.ts'

const STYLES_URL = '/__melzin/styles.css'

const embedded = window.parent !== window
let view: MelzinView<Record<string, unknown>> | null = null
let pendingData: Record<string, unknown> | null = null
let pendingRoute: RouteInput | null = null
let unloading = false
addEventListener('pagehide', () => {
  unloading = true
})
let updating = false

function post(body: FrameMessageBody): void {
  if (embedded) window.parent.postMessage(frameMessage(body), location.origin)
}

function markReady(state: 'true' | 'error'): void {
  document.documentElement.dataset.melzinReady = state
}

// Linked at runtime so Bun's HTML bundler doesn't try to resolve the dynamic URL at bundle time.
function loadStylesheet(): Promise<void> {
  return new Promise((resolve) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = STYLES_URL
    link.addEventListener('load', () => resolve())
    link.addEventListener('error', () => {
      post({ type: 'warning', message: `couldn't load ${STYLES_URL}; the view is unstyled` })
      resolve()
    })
    document.head.append(link)
  })
}

async function fetchView(file: string): Promise<string> {
  const url = viewFileUrl(file)
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`couldn't load ${url}: HTTP ${response.status}`)
  return response.text()
}

function fail(message: string): void {
  const root = document.querySelector('#melzin-root') ?? document.body
  const box = document.createElement('div')
  Object.assign(box.style, {
    margin: '16px',
    padding: '12px 14px',
    border: '1px solid #fca5a5',
    borderRadius: '8px',
    background: '#fef2f2',
    color: '#991b1b',
    font: '13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
    whiteSpace: 'pre-wrap',
  })
  box.textContent = message
  root.replaceChildren(box)
  console.error(message)
  post({ type: 'error', message })
  markReady('error')
}

function applyData(data: Record<string, unknown>): void {
  if (view === null) return
  updating = true
  try {
    view.update(data)
  } finally {
    updating = false
  }
}

// Links and forms would navigate the frame (or, with target=_top, the whole shell) away from the view.
// A host decides what they do; here they only show up in the event log.
function interceptNavigation(): void {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('a, area') : null
    // SVG links can use the namespaced xlink:href, which an [href] selector doesn't match.
    const href = target?.getAttribute('href') ?? target?.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? null
    if (target == null || href === null || event.defaultPrevented) return
    event.preventDefault()
    post({ type: 'link', href, time: Date.now() })
  })
  document.addEventListener('submit', (event) => {
    event.preventDefault()
    const form = event.target instanceof HTMLFormElement ? event.target : null
    post({ type: 'link', href: `form ${form?.getAttribute('action') ?? ''}`.trim(), time: Date.now() })
  })
}

function onMessage(event: MessageEvent): void {
  if (event.origin !== location.origin || event.source !== window.parent) return
  const message = event.data
  if (!isShellMessage(message)) return
  if (message.type === 'set-route') {
    if (view === null) pendingRoute = message.route
    else view.setRoute(message.route)
  } else if (view === null) {
    pendingData = message.data
  } else {
    applyData(message.data)
  }
}

async function start(): Promise<void> {
  window.addEventListener('message', onMessage)
  interceptNavigation()
  const params = new URLSearchParams(location.search)
  // The file name or, as in the shell's URL, the bare name.
  const file = viewFileName(params.get('view')?.trim() ?? '')
  const snapshotName = params.get('snapshot')
  // The route this frame previews (SPEC D26): its name is part of the view's URL input.
  const routeName = params.get('route')
  if (!file.endsWith(VIEW_FILE_SUFFIX) || file.includes('/') || file.includes('\\')) {
    fail(`melzin: expected ?view=<name> or ?view=<name>${VIEW_FILE_SUFFIX}, got '${params.get('view') ?? ''}'`)
    return
  }

  let html: string
  try {
    ;[html] = await Promise.all([fetchView(file), loadStylesheet()])
  } catch (error) {
    // A frame torn down mid-load (shell reload, view switch) aborts its fetches; that isn't a failure.
    if (unloading) return
    fail(`melzin: ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  const parsed = parseViewHtml(html)
  let data: Record<string, unknown> = {}
  let route: RouteInput = routeName === null ? {} : { name: routeName }
  if (snapshotName !== null) {
    const snapshot = parsed.snapshots.find((item) => item.name === snapshotName)
    if (snapshot === undefined) {
      const names = parsed.snapshots.map((item) => `'${item.name}'`).join(', ') || 'none'
      const problems = parsed.issues
        .filter((issue) => issue.path?.startsWith('snapshots'))
        .map((issue) => `\n  - ${issue.path}: ${issue.message}`)
        .join('')
      const reason = problems === '' ? '' : `\nThe snapshots block has problems (run melzin check for positions):${problems}`
      fail(`melzin: ${file} has no snapshot named '${snapshotName}' (snapshots: ${names})${reason}`)
      return
    }
    data = structuredClone(snapshot.data)
    route = { ...route, params: { ...snapshot.route?.params }, query: { ...snapshot.route?.query } }
  }

  // A handler for every declared event: the shell logs it, nothing else happens (#43).
  const on: Record<string, (payload?: undefined) => void> = {}
  for (const name of Object.keys(parsed.schema?.events ?? {})) {
    on[name] = () => post({ type: 'event', name, time: Date.now() })
  }

  const root = document.querySelector('#melzin-root')
  if (root === null) {
    fail('melzin: #melzin-root is missing from the frame page')
    return
  }
  try {
    view = mountSource(root, html, {
      data,
      on,
      route,
      onWarning: (message) => {
        console.warn(`[melzin] ${message}`)
        // Data warnings (from mount or later updates) go stale as soon as the shell sends new data.
        const stale = updating || message.startsWith(DATA_WARNING_PREFIX)
        post(stale ? { type: 'warning', message, update: true } : { type: 'warning', message })
      },
    })
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    return
  }
  if (pendingData !== null) {
    applyData(pendingData)
    pendingData = null
  }
  if (pendingRoute !== null) {
    view.setRoute(pendingRoute)
    pendingRoute = null
  }
  post({ type: 'ready', title: parsed.title })
  markReady('true')
}

void start()
