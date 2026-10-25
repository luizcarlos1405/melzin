import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (path: string) => JSON.parse(readFileSync(join(import.meta.dir, '..', '..', path), 'utf8'))

describe('published manifests', () => {
  const cli = read('cli/package.json')
  const runtime = read('melzin/package.json')

  test('@melzin/cli takes melzin as a peer, so the shell renders with the app\'s runtime', () => {
    expect(cli.dependencies?.melzin).toBeUndefined()
    expect(cli.peerDependencies.melzin).toBe('workspace:^')
    // Still linked in this workspace for development and tests.
    expect(cli.devDependencies.melzin).toBe('workspace:*')
  })

  test('melzin builds dist before packing', () => {
    expect(runtime.scripts.prepack).toBe('bun run build')
  })

  test('the CI workflow runs the packed-install check', () => {
    const workflow = readFileSync(join(import.meta.dir, '..', '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8')
    expect(workflow).toContain('scripts/check-packed-install.sh')
  })
})
