# Melzin

Na chupeta.

It's a plugin for the Alpine framework.

**Design is implementation**: the same process that defines how things look and where data appears should also be the UI/UX implementation.

This is an attempt to build this concept on top of Alpine. It uses custom directives, web-components that reads from a single, reactive and global state object.

## Interface

The html only expects a value and sometimes a path to the value.

A path is a dot separated string that points to a value in the state object.
If it has two dots at the beginning, it starts from the root of the state object.

Ex: state = { person { name: "Newton" } }

Suppose the current path is "person".
".name" -> "Newton" and "..person.name" -> "Newton"

### Directives

Everything between `[]` is optional.

#### `x-value[:domProperty][.path.to.value][='defaultValue']`

A directive that syncronizes the dom property with the value at the path. If there's a path, this implies the current path points to an object. If the initial state has no value at the path, it will be set to the evaluation of the expression.

#### `x-path.new[.prefix.path]`

A directive that sets a path to an element and all its children.

#### x-each

A directive that expects the current path to have be an array-like object. It should be used only on <template> tags. It will create a new element with the path pointing to each item in the array.

#### x-handler:eventname="handlerName[.preventDefault][.stopPropagation]"

#### x-component

#### Examples:

state: { name: "Newton" }

```html
<div x-path.name x-value>Newton</div>

<div x-value.name>Newton</div>
```

### Magics

#### `$index`

The index of the current item in an x-each directive

### Web Components

#### `x-import`

#### `x-route`

## Development

To start the development server run:

```bash
bun run dev
```

It also builds the frontend javascript code inside the `build` folder.

Open http://localhost:3000/ with your browser to see the result.
