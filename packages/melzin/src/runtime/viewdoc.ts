// Reads a view file in the browser: DOMParser for the document, core for the schema and snapshots.

import {
  type Issue,
  type MelzinSchema,
  type Snapshot,
  SCHEMA_BLOCK_TYPE,
  SNAPSHOTS_BLOCK_TYPE,
  dataBlockType,
  parseSnapshots,
  validateSchema,
} from '../core/index.ts'

export type ParsedView = {
  /** Text of `<title>`, '' when missing. */
  title: string
  /** Null when there is no schema block, or it is invalid (see `issues`). */
  schema: MelzinSchema | null
  snapshots: Snapshot[]
  /** The parsed document's `<body>` (an inert document; nothing in it runs). */
  body: HTMLElement
  issues: Issue[]
}

/** Result of reading the schema block alone: `present` is false for a view without one. */
export type SchemaBlockResult = { present: boolean; schema: MelzinSchema | null; issues: Issue[] }

export function parseDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

/** The `<script type="...">` data blocks of that type inside `<head>` (or `<body>`), in document order. */
function dataBlocks(root: HTMLElement, type: string): HTMLScriptElement[] {
  return [...root.querySelectorAll('script')].filter((script) => dataBlockType(script.getAttribute('type')) === type)
}

// Text or a disallowed element in <head> makes the HTML parser end the head early, so the blocks after
// it land in <body>. Say so instead of silently treating the view as having no schema.
function misplacedIssue(doc: Document, type: string, label: string): Issue | undefined {
  if (dataBlocks(doc.body, type).length === 0) return undefined
  return {
    message:
      `the ${type} block ended up in <body>: something before it in <head> (text, or an element other than ` +
      '<title>, <meta> and the data blocks) ended the head early; run melzin check to find it',
    path: label,
  }
}

type BlockJson = { present: false } | { present: true; ok: true; value: unknown } | { present: true; ok: false; issue: Issue }

function readBlockJson(doc: Document, type: string, label: string, issues: Issue[]): BlockJson {
  const blocks = dataBlocks(doc.head, type)
  const first = blocks[0]
  if (first === undefined) {
    const misplaced = misplacedIssue(doc, type, label)
    return misplaced === undefined ? { present: false } : { present: true, ok: false, issue: misplaced }
  }
  if (blocks.length > 1) {
    issues.push({ message: `only one <script type="${type}"> block is allowed, found ${blocks.length}`, path: label })
  }
  try {
    return { present: true, ok: true, value: JSON.parse(first.textContent ?? '') }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { present: true, ok: false, issue: { message: `the ${type} block isn't valid JSON: ${detail}`, path: label } }
  }
}

export function readSchemaBlock(doc: Document): SchemaBlockResult {
  const issues: Issue[] = []
  const block = readBlockJson(doc, SCHEMA_BLOCK_TYPE, 'schema', issues)
  if (!block.present) return { present: false, schema: null, issues }
  if (!block.ok) return { present: true, schema: null, issues: [...issues, block.issue] }
  const result = validateSchema(block.value)
  issues.push(...result.issues)
  return { present: true, schema: issues.length === 0 ? result.schema : null, issues }
}

/**
 * Parses a view file's source. Never throws for content problems: invalid JSON, schema and snapshot
 * issues are reported in `issues`. Snapshot data is checked against the schema only when the schema
 * is valid (or absent, which means only `{}` is valid data).
 */
export function parseViewHtml(html: string): ParsedView {
  const doc = parseDocument(html)
  const issues: Issue[] = []
  const schemaBlock = readSchemaBlock(doc)
  issues.push(...schemaBlock.issues)
  const schemaValid = schemaBlock.issues.length === 0

  let snapshots: Snapshot[] = []
  const block = readBlockJson(doc, SNAPSHOTS_BLOCK_TYPE, 'snapshots', issues)
  if (block.present) {
    if (block.ok) {
      const result = parseSnapshots(block.value, schemaBlock.schema, { validateData: schemaValid })
      snapshots = result.snapshots
      issues.push(...result.issues)
    } else {
      issues.push(block.issue)
    }
  }

  // Only the head's own <title>: an inline SVG's <title> in the body isn't the view's name.
  const titleElement = [...doc.head.children].find((child) => child.localName === 'title')
  const title = (titleElement?.textContent ?? '').replace(/\s+/g, ' ').trim()
  return { title, schema: schemaBlock.schema, snapshots, body: doc.body, issues }
}
