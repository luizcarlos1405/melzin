// Where a Melzin project keeps its views, theme and design alternatives. Commands run from the
// project root.

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { CURRENT_VERSION, EXPLORE_DIR, ROUTES_FILE, VIEW_FILE_SUFFIX } from 'melzin/core'

export const DEFAULT_VIEWS_DIR = 'views'
export const DEFAULT_THEME_FILE = 'theme.css'
/** Static files (fonts, images) served at the shell's root, next to the views. */
export const DEFAULT_PUBLIC_DIR = 'public'
/** The theme an alternative may bring in its folder, layered over the project's (SPEC D32). */
export const ALTERNATIVE_THEME_FILE = 'theme.css'

export type ProjectOptions = {
  /** Project root; defaults to process.cwd(). */
  cwd?: string
  /** Views directory, relative to cwd (default `views`). */
  views?: string
  /** Theme file, relative to cwd (default `theme.css`). It may not exist. */
  theme?: string
}

/** A design alternative (SPEC D31): a folder of views that stand in for the views of the same name. */
export type Alternative = {
  /** The folder's name: explore/<name>/. */
  name: string
  /** Absolute folder path. */
  dir: string
  /** Absolute path of the folder's theme.css (check `existsSync`), layered over the project's (D32). */
  themeFile: string
  /** Absolute paths of the `*.mel.html` files directly inside the folder, sorted by name. */
  views: string[]
}

export type Project = {
  /** Absolute project root. */
  root: string
  /** Absolute views directory. */
  viewsDir: string
  /** Absolute theme file path (check `existsSync` before reading). */
  themeFile: string
  /** Absolute path of the route table, routes.json at the root (check `existsSync` before reading). */
  routesFile: string
  /** Absolute path of explore/, where design alternatives live (SPEC D31). It may not exist. */
  exploreDir: string
  /** Absolute path of public/, served at the shell's root (fonts, images). It may not exist. */
  publicDir: string
  /**
   * Absolute paths of the `*.mel.html` files directly inside viewsDir, sorted by name. Dotfiles
   * (such as an editor's `.#name.mel.html` lock file) and entries that can't be read are skipped.
   */
  listViews(): string[]
  /**
   * The folders directly inside exploreDir, sorted by name, with their views. Dotfiles, a folder named
   * `current` (see misplacedViewProblem) and anything whose real path leaves exploreDir are skipped.
   */
  listAlternatives(): Alternative[]
}

/** The `*.mel.html` files directly inside dir, sorted by name; dotfiles and unreadable entries skipped. */
function listViewFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith(VIEW_FILE_SUFFIX) && !name.startsWith('.'))
    .sort()
    .map((name) => join(dir, name))
    .filter((path) => {
      try {
        return statSync(path).isFile()
      } catch {
        return false // a dangling symlink, say
      }
    })
}

/** The real path, or null when it can't be resolved. */
function realPath(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

export function resolveProject(options: ProjectOptions = {}): Project {
  const root = resolve(options.cwd ?? process.cwd())
  const viewsDir = resolve(root, options.views ?? DEFAULT_VIEWS_DIR)
  const themeFile = resolve(root, options.theme ?? DEFAULT_THEME_FILE)
  const exploreDir = join(root, EXPLORE_DIR)
  return {
    root,
    viewsDir,
    themeFile,
    routesFile: join(root, ROUTES_FILE),
    exploreDir,
    publicDir: join(root, DEFAULT_PUBLIC_DIR),
    listViews: () => listViewFiles(viewsDir),
    listAlternatives() {
      const realExplore = existsSync(exploreDir) && statSync(exploreDir).isDirectory() ? realPath(exploreDir) : null
      if (realExplore === null) return []
      const alternatives: Alternative[] = []
      for (const name of readdirSync(exploreDir).sort()) {
        if (name.startsWith('.') || name === CURRENT_VERSION) continue
        const dir = join(exploreDir, name)
        const real = realPath(dir)
        if (real === null || !isInside(realExplore, real) || !statSync(real).isDirectory()) continue
        const views = listViewFiles(dir).filter((path) => {
          const file = realPath(path)
          return file !== null && isInside(real, file)
        })
        alternatives.push({ name, dir, themeFile: join(dir, ALTERNATIVE_THEME_FILE), views })
      }
      return alternatives
    },
  }
}

/**
 * Why a view file in explore/ can't be an alternative, or undefined (SPEC D31): alternatives go in a
 * folder each, and `current` names the version in views/. Files elsewhere are never misplaced.
 */
export function misplacedViewProblem(project: Project, path: string): string | undefined {
  const rel = relative(project.exploreDir, resolve(path))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined
  const parts = rel.split(sep)
  if (parts.length === 1) {
    return `alternatives go in a folder each, such as ${EXPLORE_DIR}/<alternative>/${parts[0]}; the folder's name is the alternative's`
  }
  if (parts.length === 2 && parts[0] === CURRENT_VERSION) {
    return `'${CURRENT_VERSION}' is what the shell calls the version in the views folder, so it can't name an alternative; rename ${EXPLORE_DIR}/${CURRENT_VERSION}/`
  }
  return undefined
}

/** View files in explore/ that misplacedViewProblem rejects, with the reason, sorted by path. */
export function misplacedViews(project: Project): { path: string; problem: string }[] {
  const { exploreDir } = project
  const candidates = [...listViewFiles(exploreDir), ...listViewFiles(join(exploreDir, CURRENT_VERSION))]
  return candidates.flatMap((path) => {
    const problem = misplacedViewProblem(project, path)
    return problem === undefined ? [] : [{ path, problem }]
  })
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

/**
 * Maps the parts of an `/explore/<alternative>/<file>` URL to an alternative's view file, or null:
 * the alternative must be one listAlternatives returns and the file one of its views, under the same
 * rules as resolveViewFile.
 */
export function resolveAlternativeFile(project: Project, rawAlternative: string, rawName: string): string | null {
  let alternative: string
  let name: string
  try {
    alternative = decodeURIComponent(rawAlternative)
    name = decodeURIComponent(rawName)
  } catch {
    return null
  }
  if (name === '' || name.startsWith('.') || /[/\\\0]/.test(name) || !name.endsWith(VIEW_FILE_SUFFIX)) return null
  const found = project.listAlternatives().find((candidate) => candidate.name === alternative)
  return found?.views.find((candidate) => basename(candidate) === name) ?? null
}

/** Whether `path` (a real path) sits inside `dir` (a real path), possibly in a subfolder. */
function isWithin(dir: string, path: string): boolean {
  const rel = relative(dir, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Maps a URL path to a file in public/, served at the shell's root (`/fonts/x.woff2` →
 * `public/fonts/x.woff2`), or null. The path is URL-decoded relative segments; `..`, `.`, dotfiles,
 * separators other than `/` and anything whose real path leaves public/ are rejected.
 */
export function resolvePublicFile(project: Project, rawPath: string): string | null {
  let path: string
  try {
    path = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  const segments = path.split('/')
  const unsafe = (segment: string) => segment === '' || segment === '.' || segment === '..' || segment.startsWith('.') || /[\\\0]/.test(segment)
  if (path.startsWith('/') || segments.some(unsafe)) return null
  const full = join(project.publicDir, ...segments)
  try {
    const realPublic = realpathSync(project.publicDir)
    const realFile = realpathSync(full)
    if (!isWithin(realPublic, realFile) || !statSync(realFile).isFile()) return null
  } catch {
    return null
  }
  return full
}

/** Thrown for bad command-line usage; the CLI prints the message and exits with code 2. */
export class UsageError extends Error {
  override name = 'UsageError'
}
