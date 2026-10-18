import { describe, expect, test } from 'bun:test'
import {
  describeCharacter,
  parseClickDirective,
  parseConditionDirective,
  parseExpression,
  parseForDirective,
  parseHrefDirective,
  parseTextDirective,
  tokenize,
} from '../src/core/expr.ts'

const POSITION = (path: string): string =>
  `'${path}' picks an item by position: a list's items are shown with m-for; for one particular item, have the host send it as its own field, such as featured`

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
    const arg = result.ok && result.expr.kind === 'call' ? result.expr.args[0] : undefined
    expect(arg?.kind === 'string' && arg.value).toBe("it's")
  })

  test('a leading ! negates a path or a call', () => {
    expect(parseExpression('!user.bio')).toEqual({
      ok: true,
      expr: { kind: 'not', operand: { kind: 'path', segments: ['user', 'bio'], start: 1, end: 9 }, start: 0, end: 9 },
    })
    expect(parseExpression(' ! open()')).toEqual({
      ok: true,
      expr: { kind: 'not', operand: { kind: 'call', callee: 'open', args: [], start: 3, end: 9 }, start: 1, end: 9 },
    })
  })

  const errors: [string, string, number][] = [
    ['', 'expected a path or a call, found an empty value', 0],
    ['   ', 'expected a path or a call, found an empty value', 0],
    ['user.', "expected a name after '.', found end of value", 5],
    ['user..name', "expected a name after '.', found '.'", 5],
    ['.user', "expected a name, found '.'", 0],
    ['1abc', "'1abc' isn't a valid name (use letters, digits and _, not starting with a digit)", 0],
    ['user.2', "'user.2' picks an item by position: a list's items are shown with m-for; for one particular item, have the host send it as its own field, such as featured", 5],
    ['a b', "unexpected 'b'", 2],
    ['a-b', "unexpected character '-'", 1],
    ['count + 1', "unexpected character '+'", 6],
    ["f('a'", "expected ',' or ')', found end of value", 5],
    ["f('a' 'b')", `expected ',' or ')', found string "b"`, 6],
    ["f('a',)", "remove the trailing comma: f('a')", 5],
    ['f(x)', "expected a string, found 'x' (quote it: 'x')", 2],
    ["f('abc", 'unterminated string', 2],
    ['f("a\nb")', "strings can't contain line breaks", 4],
    ["f('a\\'b')", "escape sequences aren't supported in strings", 4],
    ["f('a') x", "unexpected 'x'", 7],
    ["f('a')()", "unexpected '('", 6],
    ["$emit('x')", "use emit('name') instead of Vue's $emit", 0],
    ['a.$b', "'$b' isn't a valid name (use letters, digits and _, not starting with a digit)", 2],
    ['!', 'expected a name, found end of value', 1],
    ['!!a', "expected a name, found '!'", 1],
    ['a!', "unexpected '!'", 1],
    ['a.!b', "expected a name after '.', found '!'", 2],
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

  test('rejects !, which only works in conditions', () => {
    expect(parseTextDirective(' !count')).toEqual({
      ok: false,
      message: "m-text needs a path such as user.name; '!' only works in conditions (m-if, m-show)",
      offset: 1,
    })
  })
})

describe('parseConditionDirective', () => {
  test('a path, optionally negated', () => {
    expect(parseConditionDirective('m-if', 'user.verified')).toEqual({
      ok: true,
      condition: { path: ['user', 'verified'], negated: false },
      pathStart: 0,
    })
    expect(parseConditionDirective('m-show', ' ! user.bio ')).toEqual({
      ok: true,
      condition: { path: ['user', 'bio'], negated: true },
      pathStart: 3,
    })
  })

  test('calls are not conditions; the message names the directive', () => {
    expect(parseConditionDirective('m-show', 'isOpen()')).toEqual({
      ok: false,
      message: 'm-show needs a condition such as user.verified or !user.verified, not a call',
      offset: 0,
    })
    expect(parseConditionDirective('m-else-if', "!emit('x')")).toMatchObject({ ok: false, offset: 1 })
  })

  // [value, operator, offset, the boolean field the message names (from what is compared)]
  const operators: [string, string, number, string | undefined][] = [
    ['count > 0', '>', 6, 'hasCount'],
    ['count >= 1', '>=', 6, 'hasCount'],
    ['user.age >= 18', '>=', 9, 'hasAge'],
    ['a && b', '&&', 2, undefined],
    ['a||b', '||', 1, undefined],
    ["status === 'paid'", '===', 7, 'isPaid'],
    ['status != "draft"', '!=', 7, 'isDraft'],
    ['a != b', '!=', 2, 'hasA'],
    ['a !== b', '!==', 2, 'hasA'],
    ["ok ? 'a' : 'b'", '?', 3, undefined],
    ['-count', '-', 0, undefined],
    ['count + 1', '+', 6, undefined],
    ['members.length > 3', '>', 15, 'hasMembers'],
    ['members.length > 0 && open', '>', 15, 'hasMembers'],
  ]
  for (const [source, operator, offset, name] of operators) {
    test(`operators get one message that names the workaround: ${JSON.stringify(source)}`, () => {
      expect(parseConditionDirective('m-if', source)).toEqual({
        ok: false,
        message: `'${operator}' isn't supported yet: a condition is a path, optionally negated with !, so have the host send a boolean field${name === undefined ? '' : ` such as ${name}`}`,
        offset,
      })
    })
  }

  // A count already holds while its list has items (D34), so comparing it with 0 or 1 gets the count itself.
  const counts: [string, string, number, string][] = [
    ['members.length > 0', '>', 15, 'members.length'],
    ['members.length != 0', '!=', 15, 'members.length'],
    ['members.length !== 0', '!==', 15, 'members.length'],
    ['members.length >= 1', '>=', 15, 'members.length'],
    ['poll.options.length>0', '>', 19, 'poll.options.length'],
    ['members.length === 0', '===', 15, '!members.length'],
    ['members.length == 0', '==', 15, '!members.length'],
    ['members.length < 1', '<', 15, '!members.length'],
    ['members.length <= 0', '<=', 15, '!members.length'],
  ]
  for (const [source, operator, offset, condition] of counts) {
    test(`a count compared with 0 or 1 gets the count: ${JSON.stringify(source)}`, () => {
      const why = condition.startsWith('!')
        ? `${condition} holds while the list is empty`
        : 'a count already holds while the list has items'
      expect(parseConditionDirective('m-show', source)).toEqual({
        ok: false,
        message: `'${operator}' isn't supported yet, and ${why}: write m-show="${condition}"`,
        offset,
      })
    })
  }

  test('other parse errors pass through', () => {
    expect(parseConditionDirective('m-if', '')).toEqual({ ok: false, message: 'expected a path or a call, found an empty value', offset: 0 })
    expect(parseConditionDirective('m-if', '!!a')).toEqual({ ok: false, message: "expected a name, found '!'", offset: 1 })
    expect(parseConditionDirective('m-if', 'user.')).toEqual({ ok: false, message: "expected a name after '.', found end of value", offset: 5 })
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

  test('a path is not enough, and ! is for conditions', () => {
    expect(parseClickDirective('increment')).toEqual({
      ok: false,
      message: "m-on:click needs emit('name'), for example emit('save')",
      offset: 0,
    })
    expect(parseClickDirective("!emit('x')")).toEqual({
      ok: false,
      message: "m-on:click needs emit('name'), for example emit('save')",
      offset: 0,
    })
  })

  test('an event name, and at most a payload object', () => {
    expect(parseClickDirective('emit()')).toEqual({
      ok: false,
      message: "emit needs an event name, for example emit('save')",
      offset: 5,
    })
    expect(parseClickDirective("emit('a', 'b')")).toEqual({
      ok: false,
      message: "a payload is an object of named fields: emit('a', { <field>: <path> })",
      offset: 10,
      fix: { kind: 'positional', callee: 'emit', event: 'a' },
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

  test('a positional payload is shown in the named form, not called an unquoted string', () => {
    expect(parseClickDirective("emit('like', 1)")).toEqual({
      ok: false,
      message: "a payload is an object of named fields: emit('like', { <field>: <path> })",
      offset: 13,
      fix: { kind: 'positional', callee: 'emit', event: 'like' },
    })
    expect(parseClickDirective("emit('like', post.id)")).toEqual({
      ok: false,
      message: "a payload is an object of named fields: emit('like', { postId: post.id })",
      offset: 13,
      fix: { kind: 'positional', callee: 'emit', event: 'like', path: ['post', 'id'] },
    })
    expect(parseClickDirective("emit('like', { id: 1 })")).toEqual({
      ok: false,
      message: 'payload values are paths for now; have the host send the value as data',
      offset: 19,
    })
  })
})

describe('tokenize: brackets, braces and colons', () => {
  test('are punctuation, for payload objects and better messages', () => {
    expect(tokenize('{a:b}[]').map((token) => token.kind)).toEqual(['{', 'word', ':', 'word', '}', '[', ']', 'eof'])
  })
})

describe('positional paths', () => {
  test("a list item by position gets the fix in every directive", () => {
    expect(parseTextDirective('members.0.name')).toEqual({ ok: false, message: POSITION('members.0'), offset: 8 })
    expect(parseTextDirective('members[0].name')).toEqual({ ok: false, message: POSITION('members[0]'), offset: 7 })
    expect(parseHrefDirective('members[1].url')).toMatchObject({ ok: false, message: POSITION('members[1]') })
    expect(parseConditionDirective('m-if', '!members[0]')).toEqual({ ok: false, message: POSITION('members[0]'), offset: 8 })
  })

  test('other brackets say paths use dots', () => {
    expect(parseTextDirective('user["name"]')).toEqual({ ok: false, message: "'[' isn't part of a path; paths join names with dots, such as user.name", offset: 4 })
  })

  test("conditions still name the operator for ':'", () => {
    expect(parseConditionDirective('m-if', 'a: b')).toEqual({
      ok: false,
      message: "':' isn't supported yet: a condition is a path, optionally negated with !, so have the host send a boolean field",
      offset: 1,
    })
  })
})

describe('parseForDirective', () => {
  test('alias in path, with offsets', () => {
    expect(parseForDirective('member in members')).toEqual({ ok: true, alias: 'member', aliasStart: 0, path: ['members'], pathStart: 10 })
    expect(parseForDirective('  option in poll.options ')).toEqual({ ok: true, alias: 'option', aliasStart: 2, path: ['poll', 'options'], pathStart: 12 })
    expect(parseForDirective('\n  item\n  in\n  items\n')).toMatchObject({ ok: true, alias: 'item', path: ['items'] })
  })

  const index = "there's no index: style rows by position with Tailwind's first:, last:, odd: and nth-* variants, and identify them by the list's key"
  const shaped = 'the host sends the list as it should show: filtered, sorted and cut to length'
  const errors: [string, string, number][] = [
    ['', 'm-for needs a name for each item and a list: m-for="member in members"', 0],
    ['member of members', `use 'in': m-for="member in members"`, 7],
    ['option of poll.options', `use 'in': m-for="option in poll.options"`, 7],
    ['(member, index) in members', index, 0],
    ['(member, index) of members', index, 0],
    ['member, index in members', index, 6],
    ['(value, key, index) in object', index, 0],
    ['(member) in members', 'write it without parentheses: m-for="member in members"', 0],
    ['{ name } in members', 'name the item and read its fields: member in members, then member.name', 0],
    ['[a, b] in pairs', 'name the item and read its fields: member in members, then member.name', 0],
    ['n in 3', 'the number of rows comes from the data: put the items in snapshots', 5],
    ['n in 10', 'the number of rows comes from the data: put the items in snapshots', 5],
    ['member in members | limit', shaped, 18],
    ['member in members.slice(0, 3)', shaped, 23],
    ['member in members.filter(m => m.active)', shaped, 24],
    ['member in sortBy(members)', shaped, 16],
    ['member in members, index', shaped, 17],
    ['member in members track by member.id', shaped, 18],
    ['member', `expected 'in' after 'member', found end of value; m-for="member in members"`, 6],
    ['member.name in members', `expected 'in' after 'member', found '.'; m-for="member in members"`, 6],
    ['member in', `expected a list after 'in', as in m-for="member in members"`, 9],
    ['in members', `name the item before 'in': m-for="member in members"`, 0],
    ['1st in members', "'1st' isn't a valid name (use letters, digits and _, not starting with a digit)", 0],
    ['__proto__ in members', "'__proto__' isn't a valid name (it's reserved)", 0],
    ['m in members.0', POSITION('members.0'), 13],
    ["m in 'abc", 'unterminated string', 5],
    ['m in members.', "expected a name after '.', found end of value", 13],
    ['m in !members', "expected a list after 'in', as in m-for=\"member in members\", found '!'", 5],
    ['m in a + b', shaped, 7],
    // Only an operator after the list starts a filter; any other stray character is named where it is.
    ['member in members\u00a0', 'unexpected character U+00A0 (no-break space)', 17],
    ['member in members\u200b', 'unexpected character U+200B (zero-width space)', 17],
    ['member in mem\u200bbers', 'unexpected character U+200B (zero-width space)', 13],
    ['member in m\u00e9mbers', "unexpected character '\u00e9'", 11],
    ['tag in t\u00e4gs', "unexpected character '\u00e4'", 8],
    ['member in members;', "unexpected character ';'", 17],
    ['member in members"', 'unterminated string', 17],
    ['member in members\\', "unexpected character '\\'", 17],
    ['member in members => x', shaped, 18],
  ]
  for (const [source, message, offset] of errors) {
    test(`error: ${JSON.stringify(source)}`, () => {
      expect(parseForDirective(source)).toEqual({ ok: false, message, offset })
    })
  }
})

describe('parseClickDirective: payloads (D35)', () => {
  test('an object of named paths, with offsets', () => {
    const value = "emit('vote', { optionId: option.id, label: option.label })"
    expect(parseClickDirective(value)).toEqual({
      ok: true,
      event: 'vote',
      payload: {
        fields: [
          { name: 'optionId', nameStart: 15, path: ['option', 'id'], pathStart: 25, pathEnd: 34 },
          { name: 'label', nameStart: 36, path: ['option', 'label'], pathStart: 43, pathEnd: 55 },
        ],
        start: 13,
        end: 57,
      },
    })
  })

  test('a trailing comma, an empty object, data and route paths', () => {
    expect(parseClickDirective("emit('a', { x: y, })")).toMatchObject({ ok: true, payload: { fields: [{ name: 'x', path: ['y'] }] } })
    expect(parseClickDirective("emit('a', {})")).toEqual({ ok: true, event: 'a', payload: { fields: [], start: 10, end: 12 } })
    expect(parseClickDirective("emit('a', { id: route.params.id })")).toMatchObject({ ok: true, payload: { fields: [{ path: ['route', 'params', 'id'] }] } })
  })

  const errors: [string, string, number][] = [
    ["emit('vote', option.id)", "a payload is an object of named fields: emit('vote', { optionId: option.id })", 13],
    ["emit('vote', id)", "a payload is an object of named fields: emit('vote', { id: id })", 13],
    ["emit('vote', true)", "a payload is an object of named fields: emit('vote', { <field>: <path> })", 13],
    ["emit('vote', !x)", "a payload is an object of named fields: emit('vote', { <field>: <path> })", 13],
    ["emit('vote', [x])", "a payload is an object of named fields: emit('vote', { <field>: <path> })", 13],
    ["emit('vote', { optionId })", "write the value's path too: { optionId: optionId }", 24],
    ["emit('vote', { optionId, label })", "write the value's path too: { optionId: optionId }", 23],
    ["emit('vote', { optionId: 'pizza' })", 'payload values are paths for now; have the host send the value as data', 25],
    ["emit('vote', { count: 1 })", 'payload values are paths for now; have the host send the value as data', 22],
    ["emit('vote', { done: false })", 'payload values are paths for now; have the host send the value as data', 21],
    ["emit('vote', { done: null })", 'payload values are paths for now; have the host send the value as data', 21],
    ["emit('vote', { done: !option.done })", "payload values are paths; '!' only works in conditions (m-if, m-show)", 21],
    ["emit('vote', { id: f(x) })", 'payload values are paths, not calls; have the host send the value as data', 20],
    ["emit('vote', { id: option.id() })", 'payload values are paths, not calls; have the host send the value as data', 28],
    ["emit('vote', { label: option.label.trim() })", 'payload values are paths, not calls; have the host send the value as data', 39],
    ["emit('vote', { o: { id: x } })", 'payload values are paths to strings, numbers or booleans for now; give each value a field of its own', 18],
    ["emit('vote', { a: x, a: y })", "'a' appears twice in the payload; keep one", 21],
    ["emit('vote', { 'a': x })", 'write field names without quotes: { a: x }', 15],
    ["emit('vote', { 'option id': option.id })", 'write field names without quotes: { optionId: option.id }', 15],
    ["emit('vote', { 'a' })", 'write field names without quotes: { a: <path> }', 15],
    ["emit('vote', { a x })", "expected ':' after 'a', found 'x'", 17],
    ["emit('vote', { a: x y })", "expected ',' or '}', found 'y'", 20],
    ["emit('vote', { a: x", "expected ',' or '}', found end of value", 19],
    ["emit('vote', {", "expected '}' to close the payload, found end of value", 14],
    ["emit('vote', { __proto__: x })", "'__proto__' isn't a valid field name (it's reserved)", 15],
    ["emit('vote', { a: x }, { b: y })", "emit takes the event name and one payload object: emit('vote', { a: x, b: y })", 23],
    ["emit('vote', { a: x }, b)", "emit takes the event name and one payload object: emit('vote', { a: x })", 23],
    ["emit('vote', {}, 'b')", "emit takes the event name and one payload object: emit('vote', {})", 17],
    ["emit('vote', 'a', b)", "a payload is an object of named fields: emit('vote', { <field>: <path> })", 13],
    // A trailing comma or a missing payload names what to write, never a string.
    ["emit('vote', { a: x }, )", "remove the trailing comma: emit('vote', { a: x })", 21],
    ["emit('vote',)", "remove the trailing comma: emit('vote')", 11],
    ["emit('vote', ,)", "expected a payload object, found ','", 13],
    ["emit('vote', ", 'expected a payload object, found end of value', 13],
    ["emit('vote', { : x })", "expected a field name, found ':'", 15],
    ["emit('vote', { a: })", "expected the value's path, found '}'", 18],
    ["emit('vote', { a: members[0].id })", POSITION('members[0]'), 25],
    ["emit({ a: x })", "the name comes first: emit('name', { ... })", 5],
  ]
  for (const [source, message, offset] of errors) {
    test(`error: ${JSON.stringify(source)}`, () => {
      const { fix: _, ...result } = parseClickDirective(source) as { fix?: unknown }
      expect(result).toEqual({ ok: false, message, offset })
    })
  }

  // What the value says about the fix, for payloadFixMessage to write it with the event's own fields.
  test('payload forms emit does not take come with their fix', () => {
    const fixOf = (value: string) => {
      const parsed = parseClickDirective(value)
      return parsed.ok ? undefined : parsed.fix
    }
    expect(fixOf("emit('pick', member.handle)")).toEqual({ kind: 'positional', callee: 'emit', event: 'pick', path: ['member', 'handle'] })
    expect(fixOf("emit('pick', $event)")).toEqual({ kind: 'positional', callee: 'emit', event: 'pick' })
    expect(fixOf("emit('pick', true)")).toEqual({ kind: 'positional', callee: 'emit', event: 'pick' })
    expect(fixOf("emit('pick', 'ana')")).toEqual({ kind: 'positional', callee: 'emit', event: 'pick' })
    expect(fixOf("emit('pick', { handle })")).toEqual({ kind: 'shorthand', callee: 'emit', event: 'pick', name: 'handle' })
    expect(fixOf("emit('pick', { 'handle': member.handle })")).toEqual({ kind: 'quoted', callee: 'emit', event: 'pick', name: 'handle', path: ['member', 'handle'] })
    expect(fixOf("emit('pick', { 'handle' })")).toEqual({ kind: 'quoted', callee: 'emit', event: 'pick', name: 'handle' })
    // The rest have no fix to fill in.
    for (const value of ["emit('pick', { a: 'x' })", "emit('pick', { a: x }, b)", "emit('pick',)", "emit('pick', { a: x() })"]) expect(fixOf(value)).toBeUndefined()
  })
})
