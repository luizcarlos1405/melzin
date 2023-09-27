import "./browserJsBuild";

Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    const htmlFile = Bun.file("./src/html" + url.pathname + ".html");
    if (await htmlFile.exists()) {
      return new Response(htmlFile);
    }

    if (url.pathname.includes(".js")) {
      const jsFile = Bun.file("./build" + url.pathname);
      if (await jsFile.exists()) {
        return new Response(jsFile);
      }
    }

    const publicFile = Bun.file("./public" + url.pathname);
    if (await publicFile.exists()) {
      return new Response(publicFile);
    }

    if (!url.pathname.includes(".")) {
      return new Response(Bun.file("./src/html/index.html"));
    }

    return new Response("Not found", { status: 404 });
  },
});
