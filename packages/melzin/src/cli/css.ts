// Tailwind v4 for a project's views, compiled in-process with the official tooling (the same
// compile + Scanner pair the official Vite/PostCSS plugins use). The shell and production builds
// both call buildCss, so they get the same CSS (P5).

import { existsSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { compile, optimize } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import { UsageError, resolveProject } from './project.ts'

export type BuildCssOptions = {
  /** Project root; relative imports in the theme resolve from the theme file itself. */
  projectDir: string
  /** Directory scanned for class names (absolute, or relative to projectDir). */
  viewsDir: string
  /** `@theme { ... }` plus optional plain CSS; skipped if missing. Must not import tailwindcss. */
  themeFile?: string
  minify?: boolean
}

// Projects depend on melzin, not on tailwindcss, so `@import "tailwindcss"` resolves from here.
const tailwindDir = dirname(Bun.resolveSync('tailwindcss/package.json', import.meta.dir))

function cssString(value: string): string {
  return JSON.stringify(value)
}

/** The in-memory entry stylesheet. */
export function entryCss(viewsDir: string, themeFile: string | undefined): string {
  const lines = ['@import "tailwindcss" source(none);', `@source ${cssString(viewsDir)};`]
  if (themeFile !== undefined && existsSync(themeFile)) lines.push(`@import ${cssString(themeFile)};`)
  return lines.join('\n') + '\n'
}

export async function buildCss(options: BuildCssOptions): Promise<string> {
  const projectDir = resolve(options.projectDir)
  const viewsDir = resolve(projectDir, options.viewsDir)
  const themeFile = options.themeFile === undefined ? undefined : resolve(projectDir, options.themeFile)
  // Importing Tailwind a second time would duplicate all of its CSS.
  if (themeFile !== undefined && existsSync(themeFile) && /@import\s+(url\(\s*)?["']?tailwindcss/.test(readFileSync(themeFile, 'utf8'))) {
    throw new Error(`${themeFile} must not import tailwindcss; melzin adds it. Keep only @theme { ... } and plain CSS there`)
  }
  const compiler = await compile(entryCss(viewsDir, themeFile), {
    base: projectDir,
    onDependency: () => {},
    customCssResolver: async (id) => {
      if (id === 'tailwindcss') return join(tailwindDir, 'index.css')
      if (id.startsWith('tailwindcss/')) {
        const file = id.slice('tailwindcss/'.length)
        return join(tailwindDir, file.endsWith('.css') ? file : `${file}.css`)
      }
      return undefined
    },
  })
  // `source(none)` disables automatic detection, so only our @source (and any in the theme) count.
  const sources = compiler.root !== null && compiler.root !== 'none'
    ? [{ ...compiler.root, negated: false }, ...compiler.sources]
    : compiler.sources
  const candidates = new Scanner({ sources }).scan()
  const css = compiler.build(candidates)
  return options.minify ? optimize(css, { minify: true }).code : css
}

const CSS_USAGE = 'usage: melzin css [-o file] [--minify] [--views dir] [--theme file]'

/** `melzin css [-o file] [--minify] [--views dir] [--theme file]`: prints or writes the CSS. */
export async function runCss(args: string[]): Promise<number> {
  let values
  try {
    values = parseArgs({
      args,
      allowPositionals: false,
      options: {
        output: { type: 'string', short: 'o' },
        minify: { type: 'boolean', default: false },
        views: { type: 'string' },
        theme: { type: 'string' },
      },
    }).values
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\n${CSS_USAGE}`)
  }
  const project = resolveProject({ views: values.views, theme: values.theme })
  if (!existsSync(project.viewsDir)) {
    console.error(`melzin css: views directory not found: ${project.viewsDir}`)
    return 1
  }
  if (values.theme !== undefined && !existsSync(project.themeFile)) {
    console.error(`melzin css: theme file not found: ${project.themeFile}`)
    return 1
  }
  const css = await buildCss({
    projectDir: project.root,
    viewsDir: project.viewsDir,
    themeFile: project.themeFile,
    minify: values.minify,
  })
  if (values.output === undefined) {
    process.stdout.write(css)
  } else {
    const output = resolve(project.root, values.output)
    await mkdir(dirname(output), { recursive: true })
    await Bun.write(output, css)
    console.error(`melzin css: wrote ${values.output} (${css.length} bytes)`)
  }
  return 0
}
