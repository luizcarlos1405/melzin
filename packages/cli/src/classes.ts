// What the checker asks Tailwind about class names, for m-bind:class's conflict check (SPEC D37):
// which CSS properties a class sets, under which conditions (variants, media queries), and where
// it comes in Tailwind's CSS order. It loads the project's design system through @tailwindcss/node's
// unstable API (the one Tailwind's IntelliSense uses); if that ever fails, the check is skipped.

import { existsSync } from 'node:fs'
import { __unstable__loadDesignSystem } from '@tailwindcss/node'
import { entryCss } from './css.ts'

export type ClassInfo = {
  /** `context|property` pairs the class sets, or null for a class Tailwind doesn't know. */
  properties(name: string): readonly string[] | null
  /** Tailwind's CSS order of each class (later wins on a shared property), null for unknown ones. */
  order(names: readonly string[]): Map<string, bigint | null>
}

/** The `context|property` pairs a utility's CSS sets: declarations, with the at-rules and selector suffixes around them. */
export function declaredProperties(css: string): string[] {
  const out: string[] = []
  const stack: string[] = []
  // Tokens: '{', '}', ';' and the text between them.
  let text = ''
  for (const ch of css) {
    if (ch === '{') {
      stack.push(text.trim())
      text = ''
    } else if (ch === '}') {
      declaration(text)
      stack.pop()
      text = ''
    } else if (ch === ';') {
      declaration(text)
      text = ''
    } else text += ch
  }
  return out

  function declaration(raw: string): void {
    const colon = raw.indexOf(':')
    if (colon < 0 || stack.some((header) => header.startsWith('@property'))) return
    const property = raw.slice(0, colon).trim()
    if (property === '' || property.startsWith('--')) return
    // The class's own selector becomes '&', so `.a:hover` and `.b:hover` share a context.
    const context = stack.map((header) => header.replace(/^\.(?:\\.|[^\s:\\[>+~,])+/, '&')).join(' > ')
    out.push(`${context}|${property}`)
  }
}

/** The project's class info, or undefined when Tailwind's design system can't be loaded. */
export async function loadClassInfo(themeFiles: readonly string[]): Promise<ClassInfo | undefined> {
  try {
    const css = entryCss([], themeFiles.filter((file) => existsSync(file))).replace('@import "tailwindcss" source(none);', '@import "tailwindcss";')
    // Resolved from here: projects depend on melzin, not on tailwindcss (the theme paths are absolute).
    const system = await __unstable__loadDesignSystem(css, { base: import.meta.dir })
    const cache = new Map<string, readonly string[] | null>()
    return {
      properties(name) {
        if (!cache.has(name)) {
          const [css] = system.candidatesToCss([name])
          cache.set(name, css === null || css === undefined ? null : declaredProperties(css))
        }
        return cache.get(name)!
      },
      order(names) {
        return new Map(system.getClassOrder([...names]) as [string, bigint | null][])
      },
    }
  } catch {
    return undefined
  }
}
