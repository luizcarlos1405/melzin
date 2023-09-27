import "./browserJsBuild";

Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    const isHxRequest = req.headers.get("HX-Request") === "true";

    if (isHxRequest) {
      const filePath = url.pathname === "/" ? "/index" : url.pathname;
      const htmlFile = Bun.file("./src/html" + filePath + ".html");
      if (await htmlFile.exists()) {
        return new Response(htmlFile, {
          headers: { "Content-Type": "text/html;charset=utf-8" },
          status: 200,
        });
      }

      return new Response("Ooops, nothing here.", { status: 404 });
    }

    if (url.pathname.includes(".js")) {
      const jsFile = Bun.file("./build" + url.pathname);
      if (await jsFile.exists()) {
        return new Response(jsFile, {
          headers: { "Content-Type": "text/javascript;charset=utf-8" },
        });
      }
    }

    const publicFile = Bun.file("./public" + url.pathname);
    if (await publicFile.exists()) {
      return new Response(publicFile);
    }

    return new Response(Bun.file("./src/index.html"));
  },
});
