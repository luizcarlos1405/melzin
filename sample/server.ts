// The poll app's backend: it owns the votes, shapes them for the screen and serves the page, the view
// files (unchanged, P5) and the CSS built from those same views.

import { VIEW_FILE_HEADERS, buildCss, resolveProject, resolveViewFile } from 'melzin/tools'
import indexPage from './index.html'
import type { Data } from './views/poll.types.ts'

export const QUESTION = 'What should we eat at the next team meetup?'
export const OPTIONS = ['pizza', 'tacos', 'sushi'] as const
export type Option = (typeof OPTIONS)[number]
/** What the backend stores: votes per option. */
export type PollState = Record<Option, number>

export function emptyState(): PollState {
  return { pizza: 0, tacos: 0, sushi: 0 }
}

export function isOption(value: unknown): value is Option {
  return typeof value === 'string' && (OPTIONS as readonly string[]).includes(value)
}

function percent(votes: number, total: number): string {
  return total === 0 ? '0%' : `${Math.round((votes / total) * 100)}%`
}

function totalLabel(total: number): string {
  if (total === 0) return 'No votes yet'
  return total === 1 ? '1 vote' : `${total.toLocaleString('en-US')} votes`
}

/**
 * The adapter (P3): turns stored counts into exactly the data the poll view displays, so the view
 * never computes anything. The contract test checks its output against the view's schema.
 */
export function toViewModel(state: PollState, question: string = QUESTION): Data {
  const total = state.pizza + state.tacos + state.sushi
  return {
    question,
    pizza: { votes: state.pizza, percent: percent(state.pizza, total) },
    tacos: { votes: state.tacos, percent: percent(state.tacos, total) },
    sushi: { votes: state.sushi, percent: percent(state.sushi, total) },
    totalLabel: totalLabel(total),
  }
}

export type PollServerOptions = {
  /** Defaults to 3000; 0 picks a free port. */
  port?: number
  hostname?: string
  /** Starting counts (copied). */
  state?: PollState
  /** Rebuilds the CSS on every request and enables Bun's dev bundling. Defaults to NODE_ENV !== 'production'. */
  development?: boolean
}

const NO_STORE = { 'Cache-Control': 'no-store' }

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

export function createPollServer(options: PollServerOptions = {}) {
  const state: PollState = { ...emptyState(), ...options.state }
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
      '/api/poll': {
        GET: () => json(toViewModel(state)),
      },
      '/api/poll/votes': {
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
            return json({ error: 'the body must be JSON like {"option": "pizza"}' }, 400)
          }
          const option = typeof body === 'object' && body !== null ? (body as { option?: unknown }).option : undefined
          if (!isOption(option)) {
            return json({ error: `option must be one of ${OPTIONS.join(', ')}` }, 400)
          }
          state[option] += 1
          return json(toViewModel(state))
        },
      },
      '/views/*': (request) => {
        // Only the view files the project lists qualify (melzin's guard), so encoded separators and `..`
        // never reach the file system.
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
          return new Response(`/* buildCss failed: ${message} */\n`, {
            status: 500,
            headers: { 'Content-Type': 'text/css; charset=utf-8', ...NO_STORE },
          })
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
  const server = createPollServer({ port })
  console.log(`Poll app on ${server.url}`)
}
