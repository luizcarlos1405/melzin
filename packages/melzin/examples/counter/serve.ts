// Serves the counter's production page: `bun run example:counter`, then open http://localhost:3001
// (PORT overrides the port). Bun bundles index.html and main.ts (HTML import), the view file ships
// unchanged, and the CSS comes from the same buildCss the shell uses (P5).

import { join } from 'node:path'
import { VIEW_FILE_HEADERS, buildCss, resolveProject, resolveViewFile } from '../../src/cli/tools.ts'
import page from './index.html'

export const DEFAULT_PORT = 3001

const VIEWS_PREFIX = '/views/'

export type CounterServerOptions = {
  /** 0 picks a free port. Default: PORT from the environment, else 3001. */
  port?: number
}

export async function createCounterServer(options: CounterServerOptions = {}): Promise<Bun.Server<undefined>> {
  // The package's own project: views/ and theme.css next to package.json.
  const project = resolveProject({ cwd: join(import.meta.dir, '..', '..') })
  // Built once at startup, like a production build would.
  const css = await buildCss({ projectDir: project.root, viewsDir: project.viewsDir, themeFile: project.themeFile, minify: true })

  return Bun.serve({
    port: options.port ?? Number(process.env.PORT ?? DEFAULT_PORT),
    development: false,
    routes: {
      '/': page,
      '/styles.css': new Response(css, { headers: { 'Content-Type': 'text/css; charset=utf-8' } }),
    },
    fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname.startsWith(VIEWS_PREFIX) && (request.method === 'GET' || request.method === 'HEAD')) {
        // Only a view file listed in the views dir qualifies, so `..` and separators never match.
        const path = resolveViewFile(project, pathname.slice(VIEWS_PREFIX.length))
        if (path !== null) {
          return new Response(Bun.file(path), { headers: { ...VIEW_FILE_HEADERS, 'Cache-Control': 'no-cache' } })
        }
      }
      return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    },
  })
}

if (import.meta.main) {
  const server = await createCounterServer()
  console.log(`Counter example: ${server.url.href}`)
}
