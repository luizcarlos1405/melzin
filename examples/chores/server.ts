// The chores app's backend: it owns the chores, shapes them for the screen and serves the page, the
// view files (unchanged, P5) and the CSS built from those same views.

import { VIEW_FILE_HEADERS, buildCss, resolveProject, resolveViewFile } from '@melzin/cli/tools'
import indexPage from './index.html'
import type { Data } from './views/chores.types.ts'

export type Priority = 'high' | 'normal' | 'low'
/** One chore, as the backend stores it. */
export type Chore = { id: string; title: string; done: boolean; priority: Priority }
/** Which chores the list shows. */
export type Filter = 'all' | 'open' | 'done'

export const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
]

const PRIORITY_LABELS: Record<Priority, string> = { high: 'Today', normal: 'Normal', low: 'Whenever' }

export const STARTING_CHORES: readonly Chore[] = [
  { id: 'plants', title: 'Water the plants', done: true, priority: 'normal' },
  { id: 'bins', title: 'Take the bins out', done: false, priority: 'high' },
  { id: 'laundry', title: 'Do the laundry', done: true, priority: 'normal' },
  { id: 'bathroom', title: 'Clean the bathroom', done: false, priority: 'normal' },
  { id: 'groceries', title: 'Buy groceries', done: false, priority: 'low' },
]

export function isFilter(value: unknown): value is Filter {
  return FILTERS.some((filter) => filter.id === value)
}

function progressLabel(chores: readonly Chore[]): string {
  const done = chores.filter((chore) => chore.done).length
  if (chores.length === 0) return 'Nothing to do yet'
  if (done === chores.length) return `All ${chores.length} done`
  return `${done} of ${chores.length} done`
}

/**
 * The adapter (P3): turns the stored chores and the chosen filter into exactly the data the view
 * displays. The view never counts or filters: the host sends the list as it should show, the progress
 * label already written, and a boolean per filter for the one that's current.
 */
export function toViewModel(chores: readonly Chore[], filter: Filter = 'all'): Data {
  const shown = chores.filter((chore) => filter === 'all' || chore.done === (filter === 'done'))
  return {
    title: 'Chores this week',
    progressLabel: progressLabel(chores),
    progress: chores.map(({ id, done }) => ({ id, done })),
    filters: FILTERS.map(({ id, label }) => ({ id, label, current: id === filter })),
    chores: shown.map(({ id, title, done, priority }) => ({
      id,
      title,
      done,
      priority,
      priorityLabel: PRIORITY_LABELS[priority],
      toggleLabel: title,
    })),
    emptyLabel: filter === 'all' ? 'No chores yet' : filter === 'open' ? 'Nothing left to do' : 'Nothing done yet',
  }
}

export type ChoresServerOptions = {
  /** Defaults to 3000; 0 picks a free port. */
  port?: number
  hostname?: string
  /** Starting chores (copied). Defaults to STARTING_CHORES. */
  chores?: readonly Chore[]
  /** Rebuilds the CSS on every request and enables Bun's dev bundling. Defaults to NODE_ENV !== 'production'. */
  development?: boolean
}

const NO_STORE = { 'Cache-Control': 'no-store' }

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

function filterOf(request: Request): Filter {
  const show = new URL(request.url).searchParams.get('show')
  return isFilter(show) ? show : 'all'
}

export function createChoresServer(options: ChoresServerOptions = {}) {
  const chores: Chore[] = (options.chores ?? STARTING_CHORES).map((chore) => ({ ...chore }))
  const development = options.development ?? process.env.NODE_ENV !== 'production'
  const project = resolveProject({ cwd: import.meta.dir })

  let cachedCss: Promise<string> | undefined
  const css = (): Promise<string> => {
    const build = () => buildCss({ projectDir: project.root, viewsDir: project.viewsDir, themeFile: project.themeFile })
    if (development) return build()
    cachedCss ??= build()
    return cachedCss
  }

  return Bun.serve({
    port: options.port ?? 3000,
    hostname: options.hostname,
    development,
    routes: {
      '/': indexPage,
      '/api/chores': {
        GET: (request) => json(toViewModel(chores, filterOf(request))),
      },
      '/api/chores/toggle': {
        POST: async (request) => {
          // JSON only: a cross-site form or no-cors fetch can't send application/json without a preflight.
          const type = request.headers.get('Content-Type') ?? ''
          if (!/^application\/json\s*(;|$)/i.test(type)) {
            return json({ error: 'send JSON with Content-Type: application/json' }, 415)
          }
          let body: unknown
          try {
            body = await request.json()
          } catch {
            return json({ error: 'the body must be JSON like {"choreId": "bins"}' }, 400)
          }
          // The same shape as the view's toggle payload, so the client passes it through.
          const id = typeof body === 'object' && body !== null ? (body as { choreId?: unknown }).choreId : undefined
          const chore = chores.find((known) => known.id === id)
          if (chore === undefined) return json({ error: `choreId must be one of ${chores.map((known) => known.id).join(', ')}` }, 400)
          chore.done = !chore.done
          return json(toViewModel(chores, filterOf(request)))
        },
      },
      '/views/*': (request) => {
        const file = resolveViewFile(project, new URL(request.url).pathname.slice('/views/'.length))
        if (file === null) return new Response('Not found', { status: 404 })
        return new Response(Bun.file(file), { headers: { ...VIEW_FILE_HEADERS, ...NO_STORE } })
      },
      '/styles.css': async () => {
        try {
          return new Response(await css(), {
            headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': development ? 'no-store' : 'no-cache' },
          })
        } catch (error) {
          const message = String((error as Error).message ?? error).replaceAll('*/', '* /')
          return new Response(`/* buildCss failed: ${message} */\n`, { status: 500, headers: { 'Content-Type': 'text/css; charset=utf-8', ...NO_STORE } })
        }
      },
    },
    fetch: () => new Response('Not found', { status: 404 }),
  })
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`PORT must be a port number, got ${JSON.stringify(process.env.PORT)}`)
    process.exit(1)
  }
  const server = createChoresServer({ port })
  console.log(`Chores app on ${server.url}`)
}
