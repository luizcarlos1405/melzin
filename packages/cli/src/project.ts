// Where a Melzin project keeps its views and theme. Commands run from the project root.

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { VIEW_FILE_SUFFIX } from 'melzin/core'

export const DEFAULT_VIEWS_DIR = 'views'
export const DEFAULT_THEME_FILE = 'theme.css'

export type ProjectOptions = {
  /** Project root; defaults to process.cwd(). */
  cwd?: string
  /** Views directory, relative to cwd (default `views`). */
  views?: string
  /** Theme file, relative to cwd (default `theme.css`). It may not exist. */
  theme?: string
}

export type Project = {
  /** Absolute project root. */
  root: string
  /** Absolute views directory. */
  viewsDir: string
  /** Absolute theme file path (check `existsSync` before reading). */
  themeFile: string
  /**
   * Absolute paths of the `*.mel.html` files directly inside viewsDir, sorted by name. Dotfiles
   * (such as an editor's `.#name.mel.html` lock file) and entries that can't be read are skipped.
   */
  listViews(): string[]
}

export function resolveProject(options: ProjectOptions = {}): Project {
  const root = resolve(options.cwd ?? process.cwd())
  const viewsDir = resolve(root, options.views ?? DEFAULT_VIEWS_DIR)
  const themeFile = resolve(root, options.theme ?? DEFAULT_THEME_FILE)
  return {
    root,
    viewsDir,
    themeFile,
    listViews() {
      if (!existsSync(viewsDir) || !statSync(viewsDir).isDirectory()) return []
      return readdirSync(viewsDir)
        .filter((name) => name.endsWith(VIEW_FILE_SUFFIX) && !name.startsWith('.'))
        .sort()
        .map((name) => join(viewsDir, name))
        .filter((path) => {
          try {
            return statSync(path).isFile()
          } catch {
            return false // a dangling symlink, say
          }
        })
    },
  }
}

/**
 * Response headers for a view file served as is. The view is mounted through fetch, so the CSP only
 * matters when someone opens the file's URL directly: it then renders sandboxed, with nothing loaded
 * or run, instead of as a page of the app's origin.
 */
export const VIEW_FILE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "sandbox; default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
}

function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path)
  return rel !== '' && !rel.startsWith('..') && dirname(rel) === '.'
}

/**
 * Maps the part of a `/views/<file>` URL after the prefix to a view file's absolute path, or null.
 * Every server that serves view files (the shell, the counter example, apps) uses this guard.
 * Only `*.mel.html` files directly inside the views dir qualify: no separators, no `..`, no
 * dotfiles, and the real path (after symlinks) must still be inside the views dir.
 */
export function resolveViewFile(project: Project, rawName: string): string | null {
  let name: string
  try {
    name = decodeURIComponent(rawName)
  } catch {
    return null
  }
  if (name === '' || name.startsWith('.') || /[/\\\0]/.test(name) || !name.endsWith(VIEW_FILE_SUFFIX)) return null
  const path = project.listViews().find((candidate) => basename(candidate) === name)
  if (path === undefined) return null
  try {
    const realDir = realpathSync(project.viewsDir)
    const realFile = realpathSync(path)
    if (!isInside(realDir, realFile) || !statSync(realFile).isFile()) return null
  } catch {
    return null
  }
  return path
}

/** Thrown for bad command-line usage; the CLI prints the message and exits with code 2. */
export class UsageError extends Error {
  override name = 'UsageError'
}
