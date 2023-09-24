import { Elysia } from "elysia";

const app = new Elysia()
  .get("/", () => Bun.file("./src/html/index.html"))
  .get("/example-component", () =>
    Bun.file("./src/html/example-component.html"),
  )
  .get("/js/index.js", () => Bun.file("./src/js/index.js"))
  .get("/js/framework.js", () => Bun.file("./build/framework.js"))
  .get("/js/lodash.js", () => Bun.file("./src/js/lodash.js"))
  .listen(3000);

console.info(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
