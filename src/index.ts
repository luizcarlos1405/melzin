import { Elysia } from "elysia";

const app = new Elysia()
  .get("/", () => Bun.file("./src/html/index.html"))
  .get("/js", () => Bun.file("./src/js/index.js"))
  .listen(3000);

console.info(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
