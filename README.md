# Melzin

Na chupeta.

Design is implementation. The same process that defines how things look and where data appears should also be the UI/UX implementation.

This is an attempt to build this concept on top of Alpine. It use custom directives, web-components and having a single, reactive and global state object.

## Directives

### x-prop

### x-scope and data-scope

### x-each

### x-event

### x-component

## Web Components

### x-import

### x-route

## Development

To start the development server run:

```bash
bun run dev
```

It also builds the frontend javascript code inside the `build` folder.

Open http://localhost:3000/ with your browser to see the result.

# How it works

This is the current `src/html/index.js` file which serves as an introduction too. Expect things to break for no reason.

Every html file inside the `src/html` folder is statically served. The route is it's path minus the `.html` extension. Ex: `file/path.html` is served at `/file/path`.

Play with changing the values inside the `Alpine.app.state` object, and see things changing, or breaking. Let me know if it's the second.

```html
<script>
  document.addEventListener("alpine:initialized", () => {
    console.log(
      "After Alpine initialized, you can access the app state at Alpine.app.state in javascript: \n\n",
      JSON.stringify(Alpine.app.state, null, 2),
    );
    console.log(
      "Try Alpine.app.state.valueKey = 'newValue' to change the valueKey value",
    );
  });
</script>

<!-- Declare a proprety and it will sync the innerText of the element -->
<div x-prop="valueKey"></div>
<div x-prop="valueKeyWithDefaultString:'defaultString'"></div>
<div x-prop="valueKeyWithDefaultNumber:42"></div>
<div x-prop="valueKeyWithDefaultInnerText">default inner text</div>

<!-- Create component -->
<template x-component="person">
  <div>
    <!-- Strings must be between '' -->
    <div x-prop="name:'Default Name Value'"></div>
    <div x-prop="email">inlinedefault@email.com</div>
    <div x-prop="age:14"></div>
  </div>
</template>

<!-- Spawn created component -->
<c-person></c-person>

<!-- Any subsequent components will share the same data from the -->
<!-- root of the state unless you scope it like bellow -->
<c-person></c-person>

<!-- Spawn created component within a scope -->
<c-person data-scope="scopedPerson"></c-person>

<!-- using x-scope instead of data-scope and the scopes are -->
<!-- automatically nested -->
<div x-scope="nested">
  <div x-scope="scope">
    <div
      x-prop="variable.path:'x-scope nests the scope with the outer scope accumulate'"
    ></div>
  </div>
</div>

<!-- Import component. The server should respond with the html -->
<!-- at /example-component in this case -->
<x-import from="example-component"></x-import>

<!-- Because the html above creates a component we can spawn it -->
<example-component></example-component>

<!-- Each to go over an Array and pass the current value as context -->
<!-- the default value after : is optional too -->
<template x-each="path.to.array:[{insideEach: 'defaultValue'}]">
  <div x-prop="insideEach"></div>
</template>
```
