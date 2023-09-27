import { Elysia } from "elysia";
import "./browserJsBuild";

const app = new Elysia()
  .get("/", () => Bun.file("./src/html/index.html"))
  .get("/example-component", () =>
    Bun.file("./src/html/example-component.html"),
  )
  .get("/js/index.js", () => Bun.file("./build/index.js"))
  .listen(3000);

console.info(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
