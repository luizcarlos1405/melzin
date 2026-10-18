// The profile app's backend: it owns the people and who follows whom, answers the remote source's
// requests with the adapter's view models (model.ts), and serves the page for every route, the view
// files (unchanged, P5) and the CSS built from those same views.

import { VIEW_FILE_HEADERS, buildCss, resolveProject, resolveViewFile } from '@melzin/cli/tools'
import { validateRouteTable } from 'melzin/core'
import indexPage from './index.html'
import { type Network, demoNetwork, setFollow, toMembersModel, toViewModel } from './model.ts'
import routes from './routes.json'

export type ProfileServerOptions = {
  /** Defaults to 3002; 0 picks a free port. */
  port?: number
  hostname?: string
  /** The people and follows to start from (default: demoNetwork()). Changed in place. */
  network?: Network
  /** Rebuilds the CSS on every request and enables Bun's dev bundling. Defaults to NODE_ENV !== 'production'. */
  development?: boolean
}

const NO_STORE = { 'Cache-Control': 'no-store' }

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

export function createProfileServer(options: ProfileServerOptions = {}) {
  const network = options.network ?? demoNetwork()
  const development = options.development ?? process.env.NODE_ENV !== 'production'
  const project = resolveProject({ cwd: import.meta.dir })

  let cachedCss: Promise<string> | undefined
  const css = (): Promise<string> => {
    const build = () => buildCss({ projectDir: project.root, viewsDir: project.viewsDir, themeFile: project.themeFile })
    if (development) return build()
    cachedCss ??= build()
    return cachedCss
  }

  const noProfile = (handle: string): Response => json({ error: `no profile named '${handle}'` }, 404)

  // Follows and unfollows answer with the profile as the follower now sees it, ready for page.update.
  // They are PUT and DELETE, which another site can't send without a CORS preflight this server never
  // answers, so a cross-site page can't make someone follow.
  const changeFollow = (handle: string, follower: string, follow: boolean): Response => {
    const result = setFollow(network, handle, follower, follow)
    return result.ok ? json(result.data) : json({ error: result.error }, result.status)
  }

  /** `?as=` names who is looking; an unknown name is an error, a missing or empty one means nobody. */
  const viewerOf = (request: Request): { viewer: string | null } | { error: Response } => {
    const viewer = new URL(request.url).searchParams.get('as') || null
    if (viewer !== null && !network.people.has(viewer)) return { error: json({ error: `no profile named '${viewer}' to view as` }, 400) }
    return { viewer }
  }

  // Every route's URL serves the page; the standalone host in it picks the screen (SPEC §7).
  const table = validateRouteTable(routes).table
  if (table === null) throw new Error('routes.json is invalid; run melzin check')
  const pages = Object.fromEntries(table.routes.map((route) => [route.path, indexPage]))

  return Bun.serve({
    port: options.port ?? 3002,
    hostname: options.hostname,
    development,
    routes: {
      ...pages,
      // There are no accounts in this example: `?as=ana` says who is signed in, and no `as` means nobody.
      '/api/members': {
        GET: (request) => {
          const looking = viewerOf(request)
          return 'error' in looking ? looking.error : json(toMembersModel(network, looking.viewer))
        },
      },
      '/api/profiles/:handle': {
        GET: (request) => {
          const looking = viewerOf(request)
          if ('error' in looking) return looking.error
          const data = toViewModel(network, request.params.handle, looking.viewer)
          return data === null ? noProfile(request.params.handle) : json(data)
        },
      },
      '/api/profiles/:handle/followers/:follower': {
        PUT: (request) => changeFollow(request.params.handle, request.params.follower, true),
        DELETE: (request) => changeFollow(request.params.handle, request.params.follower, false),
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
  const port = Number(process.env.PORT ?? 3002)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`PORT must be a port number, got ${JSON.stringify(process.env.PORT)}`)
    process.exit(1)
  }
  const server = createProfileServer({ port })
  console.log(`Profile app on ${server.url}`)
}
