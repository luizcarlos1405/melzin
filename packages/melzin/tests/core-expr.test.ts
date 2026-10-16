import { describe, expect, test } from 'bun:test'
import { describeCharacter, parseClickDirective, parseExpression, parseTextDirective, tokenize } from '../src/core/expr.ts'

describe('tokenize', () => {
  test('words, punctuation and strings with offsets', () => {
    expect(tokenize(" emit( 'a' ,\"b\")")).toEqual([
      { kind: 'word', value: 'emit', start: 1, end: 5 },
      { kind: '(', value: '(', start: 5, end: 6 },
      { kind: 'string', value: 'a', start: 7, end: 10 },
      { kind: ',', value: ',', start: 11, end: 12 },
      { kind: 'string', value: 'b', start: 12, end: 15 },
      { kind: ')', value: ')', start: 15, end: 16 },
      { kind: 'eof', value: '', start: 16, end: 16 },
    ])
  })
})

describe('parseExpression', () => {
  test('a single name is a path', () => {
    expect(parseExpression('count')).toEqual({ ok: true, expr: { kind: 'path', segments: ['count'], start: 0, end: 5 } })
  })

  test('dotted paths with whitespace around tokens', () => {
    expect(parseExpression('  user . name\n')).toEqual({
      ok: true,
      expr: { kind: 'path', segments: ['user', 'name'], start: 2, end: 13 },
    })
  })

  test('identifiers allow underscores and digits after the first character', () => {
    const result = parseExpression('_a1.B_2')
    expect(result.ok && result.expr.kind === 'path' && result.expr.segments).toEqual(['_a1', 'B_2'])
  })

  test('calls with zero, one and several string arguments', () => {
    expect(parseExpression('f()')).toEqual({ ok: true, expr: { kind: 'call', callee: 'f', args: [], start: 0, end: 3 } })
    expect(parseExpression(`f('a', "b c")`)).toEqual({
      ok: true,
      expr: {
        kind: 'call',
        callee: 'f',
        args: [
          { kind: 'string', value: 'a', start: 2, end: 5 },
          { kind: 'string', value: 'b c', start: 7, end: 12 },
        ],
        start: 0,
        end: 13,
      },
    })
  })

  test('quotes of the other kind are plain characters inside a string', () => {
    const result = parseExpression(`f("it's")`)
    expect(result.ok && result.expr.kind === 'call' && result.expr.args[0]?.value).toBe("it's")
  })

  const errors: [string, string, number][] = [
    ['', 'expected a path or a call, found an empty value', 0],
    ['   ', 'expected a path or a call, found an empty value', 0],
    ['user.', "expected a name after '.', found end of value", 5],
    ['user..name', "expected a name after '.', found '.'", 5],
    ['.user', "expected a name, found '.'", 0],
    ['1abc', "'1abc' isn't a valid name (use letters, digits and _, not starting with a digit)", 0],
    ['user.2', "'2' isn't a valid name (use letters, digits and _, not starting with a digit)", 5],
    ['a b', "unexpected 'b'", 2],
    ['a-b', "unexpected character '-'", 1],
    ['count + 1', "unexpected character '+'", 6],
    ["f('a'", "expected ',' or ')', found end of value", 5],
    ["f('a' 'b')", `expected ',' or ')', found string "b"`, 6],
    ["f('a',)", "expected a string, found ')'", 6],
    ['f(x)', "expected a string, found 'x' (quote it: 'x')", 2],
    ["f('abc", 'unterminated string', 2],
    ['f("a\nb")', "strings can't contain line breaks", 4],
    ["f('a\\'b')", "escape sequences aren't supported in strings", 4],
    ["f('a') x", "unexpected 'x'", 7],
    ["f('a')()", "unexpected '('", 6],
    ["$emit('x')", "use emit('name') instead of Vue's $emit", 0],
    ['a.$b', "'$b' isn't a valid name (use letters, digits and _, not starting with a digit)", 2],
  ]
  for (const [source, message, offset] of errors) {
    test(`error: ${JSON.stringify(source)}`, () => {
      expect(parseExpression(source)).toEqual({ ok: false, message, offset })
    })
  }
})

describe('parseTextDirective', () => {
  test('returns the path segments', () => {
    expect(parseTextDirective('count')).toEqual({ ok: true, path: ['count'] })
    expect(parseTextDirective(' user.name ')).toEqual({ ok: true, path: ['user', 'name'] })
  })

  test('rejects calls', () => {
    expect(parseTextDirective(" emit('x')")).toEqual({
      ok: false,
      message: 'm-text needs a path such as user.name, not a call',
      offset: 1,
    })
  })

  test('passes parse errors through', () => {
    expect(parseTextDirective('user.')).toEqual({ ok: false, message: "expected a name after '.', found end of value", offset: 5 })
  })
})

describe('parseClickDirective', () => {
  test('accepts emit with single or double quotes and whitespace', () => {
    expect(parseClickDirective("emit('increment')")).toEqual({ ok: true, event: 'increment' })
    expect(parseClickDirective(' emit ( "save_2" ) ')).toEqual({ ok: true, event: 'save_2' })
  })

  test('$emit gets the Vue hint', () => {
    expect(parseClickDirective("$emit('increment')")).toEqual({
      ok: false,
      message: "use emit('name') instead of Vue's $emit",
      offset: 0,
    })
    expect(parseClickDirective("  $emit('x')")).toMatchObject({ ok: false, offset: 2 })
  })

  test('other callees are not supported', () => {
    expect(parseClickDirective("  increment('x')")).toEqual({
      ok: false,
      message: "only emit('name') is supported for now",
      offset: 2,
    })
    // Without arguments it reads like a method call on the host: suggest the emit form.
    expect(parseClickDirective('like()')).toEqual({
      ok: false,
      message: "only emit('name') is supported for now; did you mean emit('like')?",
      offset: 0,
    })
  })

  test('a path is not enough', () => {
    expect(parseClickDirective('increment')).toEqual({
      ok: false,
      message: "m-on:click needs emit('name'), for example emit('save')",
      offset: 0,
    })
  })

  test('exactly one argument', () => {
    expect(parseClickDirective('emit()')).toEqual({
      ok: false,
      message: "emit needs an event name, for example emit('save')",
      offset: 5,
    })
    expect(parseClickDirective("emit('a', 'b')")).toEqual({
      ok: false,
      message: "emit takes exactly one argument, the event name; event payloads aren't supported yet, so declare one event per action",
      offset: 10,
    })
  })

  test('the event name must be an identifier; the offset points inside the string', () => {
    expect(parseClickDirective("emit('save item')")).toEqual({
      ok: false,
      message: "'save item' isn't a valid event name (use letters, digits and _, not starting with a digit)",
      offset: 6,
    })
    expect(parseClickDirective("emit('')")).toMatchObject({ ok: false, offset: 6 })
  })

  test('unquoted event names get a quoting hint', () => {
    expect(parseClickDirective('emit(increment)')).toEqual({
      ok: false,
      message: "expected a string, found 'increment' (quote it: 'increment')",
      offset: 5,
    })
  })

  test('unterminated strings point at the opening quote', () => {
    expect(parseClickDirective("emit('increment)")).toEqual({ ok: false, message: 'unterminated string', offset: 5 })
  })
})

describe('diagnostics for common slips', () => {
  test('invisible and space-like characters are named; emoji are shown whole', () => {
    expect(parseTextDirective('\u00a0count')).toEqual({ ok: false, message: 'unexpected character U+00A0 (no-break space)', offset: 0 })
    expect(parseTextDirective('\u200bcount')).toEqual({ ok: false, message: 'unexpected character U+200B (zero-width space)', offset: 0 })
    expect(parseTextDirective('\u{1F600}')).toEqual({ ok: false, message: "unexpected character '\u{1F600}'", offset: 0 })
    expect(parseTextDirective('a + 1')).toEqual({ ok: false, message: "unexpected character '+'", offset: 2 })
    expect(describeCharacter('\u0007', 0)).toBe('U+0007')
  })

  test('an extra non-string argument to emit is called an extra argument, not an unquoted string', () => {
    const message =
      "emit takes exactly one argument, the event name; event payloads aren't supported yet, so declare one event per action"
    expect(parseClickDirective("emit('like', 1)")).toEqual({ ok: false, message, offset: 13 })
    expect(parseClickDirective("emit('like', { id: 1 })")).toEqual({ ok: false, message, offset: 13 })
    expect(parseClickDirective("emit('like', post.id)")).toEqual({ ok: false, message, offset: 13 })
  })
})
