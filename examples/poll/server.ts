// The poll app's backend: it owns the votes, shapes them for the screen and serves the page, the view
// files (unchanged, P5) and the CSS built from those same views.

import { VIEW_FILE_HEADERS, buildCss, resolveProject, resolveViewFile } from '@melzin/cli/tools'
import indexPage from './index.html'
import type { Data } from './views/poll.types.ts'

/** One choice of a poll, as the backend defines it. */
export type PollOption = { id: string; label: string; emoji: string }
/** A poll's fixed parts: the question and its options, in the order to show. */
export type Poll = { question: string; options: readonly PollOption[] }
/** What the backend stores: votes per option id. An option that isn't in it has no votes yet. */
export type PollState = Record<string, number>

export const MEETUP_POLL: Poll = {
  question: 'What should we eat at the next team meetup?',
  options: [
    { id: 'pizza', label: 'Pizza', emoji: '🍕' },
    { id: 'tacos', label: 'Tacos', emoji: '🌮' },
    { id: 'sushi', label: 'Sushi', emoji: '🍣' },
  ],
}

export function emptyState(poll: Poll = MEETUP_POLL): PollState {
  return Object.fromEntries(poll.options.map((option) => [option.id, 0]))
}

/** The poll's option with that id, if any. A request's id is only compared, so only the poll's own ids index the counts. */
export function findOption(poll: Poll, id: unknown): PollOption | undefined {
  return typeof id === 'string' ? poll.options.find((option) => option.id === id) : undefined
}

function votesOf(state: PollState, id: string): number {
  return Object.hasOwn(state, id) ? (state[id] ?? 0) : 0
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
 * never computes anything. The options keep the poll's order rather than sorting by votes, so a row
 * never moves away from the pointer that's about to vote on it. The contract test checks the output
 * against the view's schema, keys and minItems included.
 */
export function toViewModel(state: PollState, poll: Poll = MEETUP_POLL): Data {
  const total = poll.options.reduce((sum, option) => sum + votesOf(state, option.id), 0)
  return {
    question: poll.question,
    options: poll.options.map(({ id, label, emoji }) => {
      const votes = votesOf(state, id)
      return { id, label, emoji, votes, percent: percent(votes, total) }
    }),
    totalLabel: totalLabel(total),
  }
}

export type PollServerOptions = {
  /** Defaults to 3000; 0 picks a free port. */
  port?: number
  hostname?: string
  /** The question and options. Defaults to MEETUP_POLL. */
  poll?: Poll
  /** Starting counts (copied; ids the poll doesn't have are ignored). */
  state?: PollState
  /** Rebuilds the CSS on every request and enables Bun's dev bundling. Defaults to NODE_ENV !== 'production'. */
  development?: boolean
}

const NO_STORE = { 'Cache-Control': 'no-store' }

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

export function createPollServer(options: PollServerOptions = {}) {
  const poll = options.poll ?? MEETUP_POLL
  const state: PollState = Object.fromEntries(poll.options.map(({ id }) => [id, votesOf(options.state ?? {}, id)]))
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
        GET: () => json(toViewModel(state, poll)),
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
            return json({ error: 'the body must be JSON like {"optionId": "pizza"}' }, 400)
          }
          // The same shape as the view's vote payload, so the client passes it through.
          const id = typeof body === 'object' && body !== null ? (body as { optionId?: unknown }).optionId : undefined
          const option = findOption(poll, id)
          if (option === undefined) {
            return json({ error: `optionId must be one of ${poll.options.map((known) => known.id).join(', ')}` }, 400)
          }
          state[option.id] = votesOf(state, option.id) + 1
          return json(toViewModel(state, poll))
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
