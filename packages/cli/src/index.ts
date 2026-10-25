#!/usr/bin/env bun
// `melzin <command> ...`: dispatches to the command modules. Each command parses its own flags and
// returns an exit code. Command modules are imported lazily, so one command never pays for (or breaks
// because of) another's dependencies, e.g. `check` doesn't load the shell's HTML bundle or Tailwind.

import { UsageError } from './project.ts'

type Command = { run: (args: string[]) => Promise<number>; usage: string; summary: string }

export const COMMANDS: Readonly<Record<string, Command>> = {
  check: {
    run: async (args) => (await import('./check.ts')).runCheck(args),
    usage: 'melzin check [files...] [--views dir]',
    summary: 'check view files and routes.json (default: every *.mel.html in the views dir, and routes.json)',
  },
  types: {
    run: async (args) => (await import('./types.ts')).runTypes(args),
    usage: 'melzin types <files...> [--views dir]',
    summary: 'write <name>.types.ts (Data and Handlers) next to each view, or routes.types.ts for routes.json',
  },
  shell: {
    run: async (args) => (await import('./shell.ts')).runShell(args),
    usage: 'melzin shell [--port 4321] [--views views] [--theme theme.css]',
    summary: 'start the preview shell',
  },
  css: {
    run: async (args) => (await import('./css.ts')).runCss(args),
    usage: 'melzin css [-o file] [--minify] [--views dir] [--theme file] [--alt name]',
    summary: "compile the Tailwind CSS for the project's views",
  },
}

export function helpText(): string {
  const width = Math.max(...Object.values(COMMANDS).map((command) => command.usage.length))
  const lines = Object.values(COMMANDS).map((command) => `  ${command.usage.padEnd(width)}  ${command.summary}`)
  return [
    'Melzin: views as HTML files, previewed in a shell and mounted in production.',
    '',
    'Usage:',
    ...lines,
    '',
    'Run commands from the project root (views/ and theme.css by default).',
    "Use 'melzin <command> --help' for a command's usage.",
  ].join('\n')
}

export async function main(argv: string[]): Promise<number> {
  const [name, ...args] = argv
  if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
    const out = name === undefined ? console.error : console.log
    out(helpText())
    return name === undefined ? 2 : 0
  }
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined
  if (command === undefined) {
    console.error(`melzin: unknown command '${name}'\n\n${helpText()}`)
    return 2
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`usage: ${command.usage}\n\n${command.summary}`)
    return 0
  }
  try {
    return await command.run(args)
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`melzin ${name}: ${error.message}`)
      return 2
    }
    console.error(`melzin ${name}: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}
