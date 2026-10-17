// The checker's JSON parser: same values as JSON.parse, plus positions for paths and errors.

import { describe, expect, test } from 'bun:test'
import { parseJsonWithLocations, pathAncestors } from '../src/check.ts'

describe('values match JSON.parse', () => {
  const inputs = [
    '{}',
    '[]',
    ' {"a": 1, "b": [true, false, null], "c": {"d": "e"}} ',
    '"just a string"',
    '-0.5e+3',
    '{"esc": "q\\"b\\\\s\\/n\\nt\\tu\\u00e9\\ud83d\\ude00"}',
    '{"dup": 1, "dup": 2}',
    '{"__proto__": {"x": 1}}',
    '[0, 1.5, -2, 3E2, 1e-2]',
    '{\r\n  "crlf": 1\r\n}',
  ]
  for (const input of inputs) {
    test(input, () => {
      const result = parseJsonWithLocations(input)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).toEqual(JSON.parse(input))
      expect(JSON.stringify(result.value)).toBe(JSON.stringify(JSON.parse(input)))
    })
  }

  test('__proto__ is an own property, not the prototype', () => {
    const result = parseJsonWithLocations('{"__proto__": {"x": 1}}')
    if (!result.ok) throw new Error('expected ok')
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype)
    expect(Object.keys(result.value as object)).toEqual(['__proto__'])
  })
})

describe('errors', () => {
  const cases: [string, string, number][] = [
    ['', 'the block is empty; it needs a JSON object', 0],
    ['   ', 'the block is empty; it needs a JSON object', 0],
    ['{"a": 1,}', "trailing commas aren't allowed in JSON", 8],
    ['[1, 2, ]', "trailing commas aren't allowed in JSON", 7],
    ["{'a': 1}", 'JSON strings need double quotes', 1],
    ['{a: 1}', 'property names need double quotes: "a"', 1],
    ['{"a": hello}', "unexpected 'hello'; strings need double quotes", 6],
    ['{"a": 1 // c\n}', "comments aren't allowed in JSON", 8],
    ['{"a": 1 "b": 2}', "expected ',' between properties", 8],
    ['{"a" 1}', "expected ':' after the property name, found '1'", 5],
    ['{"a": "x', 'unterminated string', 6],
    ['{"a": "x\ny"}', "strings can't contain line breaks or control characters (use \\n)", 8],
    ['{"a": "\\x"}', "invalid escape '\\x'", 7],
    ['{"a": 01}', "invalid number '01'", 6],
    ['{"a": 1} x', 'unexpected content after the JSON value', 9],
    ['{"a": ', 'unexpected end of JSON; expected a value', 6],
    ['[1 2]', "expected ',' or ']', found '2'", 3],
  ]
  for (const [input, message, offset] of cases) {
    test(JSON.stringify(input), () => {
      expect(parseJsonWithLocations(input)).toEqual({ ok: false, message, offset })
      expect(() => JSON.parse(input)).toThrow()
    })
  }
})

describe('locations', () => {
  test('keys point at the property name; array items and the root at the value', () => {
    const text = '{ "data": { "properties": { "a b": { "type": "x" } }, "required": ["q", "r"] } }'
    const result = parseJsonWithLocations(text)
    if (!result.ok) throw new Error('expected ok')
    const where = (path: string): number | undefined => result.locations.get(path)
    expect(where('')).toBe(0)
    expect(where('data')).toBe(text.indexOf('"data"'))
    expect(where('data.properties["a b"]')).toBe(text.indexOf('"a b"'))
    expect(where('data.properties["a b"].type')).toBe(text.indexOf('"type"'))
    expect(where('data.required[1]')).toBe(text.indexOf('"r"'))
  })

  test('root path and bracketed top-level keys (snapshot names)', () => {
    const text = '{ "zero": { "data": { "count": 0 } } }'
    const result = parseJsonWithLocations(text, { rootPath: 'snapshots', bracketTopLevel: true })
    if (!result.ok) throw new Error('expected ok')
    expect(result.locations.get('snapshots')).toBe(0)
    expect(result.locations.get('snapshots["zero"]')).toBe(text.indexOf('"zero"'))
    expect(result.locations.get('snapshots["zero"].data.count')).toBe(text.indexOf('"count"'))
  })

  test('the last duplicate key wins, like its value', () => {
    const text = '{"a": 1, "a": 2}'
    const result = parseJsonWithLocations(text)
    if (!result.ok) throw new Error('expected ok')
    expect(result.locations.get('a')).toBe(text.lastIndexOf('"a"'))
  })
})

test('pathAncestors', () => {
  expect(pathAncestors('a.b["c.d"][0]')).toEqual(['a.b["c.d"][0]', 'a.b["c.d"]', 'a.b', 'a', ''])
  expect(pathAncestors('snapshots["x \\" y"].data')).toEqual(['snapshots["x \\" y"].data', 'snapshots["x \\" y"]', 'snapshots', ''])
  expect(pathAncestors('')).toEqual([''])
})
