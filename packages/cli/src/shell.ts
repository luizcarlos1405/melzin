// `melzin shell`: the preview server. The shell UI and the frame page are Bun HTML imports (bundled
// on request in development); view files are served verbatim, and the CSS comes from the same
// buildCss as production builds (P5).

import { existsSync, statSync } from 'node:fs'
import { basename, relative } from 'node:path'
import { parseArgs } from 'node:util'
import framePage from '../shell/frame.html'
import shellPage from '../shell/index.html'
import { type Route, VIEW_FILE_SUFFIX } from 'melzin/core'
import { checkRoutesSource, formatDiagnostic, loadViewFile } from './check.ts'
import { buildCss } from './css.ts'
import { type Project, UsageError, VIEW_FILE_HEADERS, resolveProject, resolveViewFile } from './project.ts'

export { resolveViewFile }

export const DEFAULT_PORT = 4321
export const DEFAULT_HOSTNAME = '127.0.0.1'

export const VIEWS_API_PATH = '/__melzin/api/views'
export const ROUTES_API_PATH = '/__melzin/api/routes'
export const STYLES_PATH = '/__melzin/styles.css'
export const VIEWS_PATH_PREFIX = '/views/'

/** One entry of `/__melzin/api/views`. */
export type ViewEntry = {
  /** File name minus `.mel.html`, as used in the shell's `?view=` parameter. */
  name: string
  /** File name inside the views directory. */
  file: string
  /** Where the shell server serves the file. */
  url: string
  /** The view's `<title>`, or its name when the title is missing or the file can't be read. */
  title: string
}

/**
 * `/__melzin/api/routes`: the project's routes (SPEC D26). `routes` is empty when routes.json is missing
 * or has errors; `problems` lists the errors, formatted like melzin check's output.
 */
export type RoutesEntry = { present: boolean; routes: Route[]; problems: string[] }

export type ShellServerOptions = {
  /** The project to serve; defaults to resolveProject() for the current directory. */
  project?: Project
  /** 0 picks a free port. Default 4321. */
  port?: number
  hostname?: string
  /** Bun's development mode (unminified bundles, HMR, error overlay). Default true. */
  development?: boolean
}

const NO_STORE = { 'Cache-Control': 'no-store' }

function notFound(): Response {
  return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...NO_STORE } })
}

/** The views the server can serve (see resolveViewFile), with their titles. */
export async function listViewEntries(project: Project): Promise<ViewEntry[]> {
  const servable = project.listViews().filter((path) => resolveViewFile(project, encodeURIComponent(basename(path))) === path)
  return Promise.all(
    servable.map(async (path) => {
      const file = basename(path)
      const name = file.slice(0, -VIEW_FILE_SUFFIX.length)
      let title = ''
      try {
        title = (await loadViewFile(path)).title
      } catch {
        // Unreadable or unparsable: the picker still lists it by name, and the frame shows the error.
      }
      return { name, file, url: VIEWS_PATH_PREFIX + encodeURIComponent(file), title: title || name }
    }),
  )
}

/** The route table the shell lists as pages, with its problems. */
export async function readRoutesEntry(project: Project): Promise<RoutesEntry> {
  let source: string
  try {
    source = await Bun.file(project.routesFile).text()
  } catch {
    return { present: false, routes: [], problems: [] }
  }
  const views = project.listViews().map((path) => basename(path).slice(0, -VIEW_FILE_SUFFIX.length))
  const { diagnostics, table } = checkRoutesSource(source, views)
  const file = basename(project.routesFile)
  return { present: true, routes: table?.routes ?? [], problems: diagnostics.map((diagnostic) => formatDiagnostic(file, diagnostic)) }
}

/** Host names the shell answers to; anything else (a DNS-rebinding page, say) gets 403. */
function allowedHosts(hostname: string): Set<string> {
  return new Set(['localhost', '127.0.0.1', '[::1]', hostname.includes(':') ? `[${hostname}]` : hostname])
}

export function createShellServer(options: ShellServerOptions = {}): Bun.Server<undefined> {
  const project = options.project ?? resolveProject()
  const hosts = allowedHosts(options.hostname ?? DEFAULT_HOSTNAME)
  // The project's data (view list, view files, CSS) goes through this, so a page on another host name
  // can't read it. The shell's own pages are static bundles.
  const guard = <A extends unknown[]>(handler: (request: Request, ...rest: A) => Response | Promise<Response>) =>
    (request: Request, ...rest: A): Response | Promise<Response> => {
      const host = new URL(request.url).hostname
      if (!hosts.has(host)) return new Response('Forbidden host\n', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      return handler(request, ...rest)
    }
  return Bun.serve({
    port: options.port ?? DEFAULT_PORT,
    hostname: options.hostname ?? DEFAULT_HOSTNAME,
    development: options.development ?? true,
    routes: {
      '/': shellPage,
      '/frame': framePage,
      // Answered here so browsers' automatic favicon requests don't log a 404 on every load.
      '/favicon.ico': new Response(null, { status: 204 }),
      [VIEWS_API_PATH]: guard(async () => Response.json(await listViewEntries(project), { headers: NO_STORE })),
      [ROUTES_API_PATH]: guard(async () => Response.json(await readRoutesEntry(project), { headers: NO_STORE })),
      [STYLES_PATH]: guard(async () => {
        try {
          const css = await buildCss({ projectDir: project.root, viewsDir: project.viewsDir, themeFile: project.themeFile })
          return new Response(css, { headers: { 'Content-Type': 'text/css; charset=utf-8', ...NO_STORE } })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.error(`melzin shell: couldn't build the CSS: ${message}`)
          return new Response(`/* melzin: couldn't build the CSS: ${message.replaceAll('*/', '* /')} */\n`, {
            status: 500,
            headers: { 'Content-Type': 'text/css; charset=utf-8', ...NO_STORE },
          })
        }
      }),
    },
    fetch: guard((request) => {
      const { pathname } = new URL(request.url)
      if (pathname.startsWith(VIEWS_PATH_PREFIX) && (request.method === 'GET' || request.method === 'HEAD')) {
        const path = resolveViewFile(project, pathname.slice(VIEWS_PATH_PREFIX.length))
        if (path !== null) {
          return new Response(Bun.file(path), { headers: { ...VIEW_FILE_HEADERS, ...NO_STORE } })
        }
      }
      return notFound()
    }),
  })
}

const SHELL_USAGE = 'usage: melzin shell [--port 4321] [--views views] [--theme theme.css]'

function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT
  const port = Number(value)
  if (!/^\d+$/.test(value) || port > 65535) throw new UsageError(`--port must be a number from 0 to 65535, got '${value}'\n${SHELL_USAGE}`)
  return port
}

/**
 * `melzin shell [--port 4321] [--views views] [--theme theme.css]`. Starts the preview server; the
 * returned promise settles only when the server stops (or with a non-zero code on startup errors).
 */
export async function runShell(args: string[]): Promise<number> {
  let values
  try {
    values = parseArgs({
      args,
      allowPositionals: false,
      options: {
        port: { type: 'string', short: 'p' },
        views: { type: 'string' },
        theme: { type: 'string' },
      },
    }).values
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\n${SHELL_USAGE}`)
  }
  const port = parsePort(values.port)
  const project = resolveProject({ views: values.views, theme: values.theme })
  if (!existsSync(project.viewsDir) || !statSync(project.viewsDir).isDirectory()) {
    console.error(`melzin shell: views directory not found: ${project.viewsDir}`)
    return 1
  }
  if (values.theme !== undefined && !existsSync(project.themeFile)) {
    console.error(`melzin shell: theme file not found: ${project.themeFile}`)
    return 1
  }

  let server: Bun.Server<undefined>
  try {
    server = createShellServer({ project, port })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const inUse = /in use|EADDRINUSE/i.test(message)
    console.error(`melzin shell: couldn't listen on ${DEFAULT_HOSTNAME}:${port}: ${message}${inUse ? ' (try --port <other>)' : ''}`)
    return 1
  }

  const rel = (path: string) => relative(process.cwd(), path) || '.'
  const theme = existsSync(project.themeFile) ? rel(project.themeFile) : 'none'
  const count = project.listViews().length
  const routes = existsSync(project.routesFile) ? rel(project.routesFile) : 'none'
  console.log(`Melzin shell: ${server.url.href}`)
  console.log(`  views: ${rel(project.viewsDir)}/ (${count} ${count === 1 ? 'view' : 'views'}), theme: ${theme}, routes: ${routes}`)
  console.log('  Refresh the page to reload views and CSS. Ctrl+C to stop.')

  return new Promise<number>((resolve) => {
    const stop = () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      void server.stop(true).then(() => resolve(0))
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  })
}
