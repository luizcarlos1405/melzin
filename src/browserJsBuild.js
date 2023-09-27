import { watch } from "fs";

const watchFolder = `${import.meta.dir}/plugin`;

const buildFrontend = () =>
  Bun.build({
    entrypoints: ["./src/js"],
    outdir: "./build",
    target: "browser",
    naming: "[name].[ext]", // default
    // format?: ModuleFormat; // later: "cjs", "iife"
    // plugins?: BunPlugin[];
    // treeshaking?: boolean;
    // jsx?:
    //   | "automatic"
    //   | "classic"
    //   | /* later: "preserve" */ {
    //       runtime?: "automatic" | "classic"; // later: "preserve"
    //       /** Only works when runtime=classic */
    //       factory?: string; // default: "React.createElement"
    //       /** Only works when runtime=classic */
    //       fragment?: string; // default: "React.Fragment"
    //       /** Only works when runtime=automatic */
    //       importSource?: string; // default: "react"
    //     };
  }).catch((error) => {
    console.error(error);
  });
await buildFrontend();
watch(watchFolder, { recursive: true }, (event, filename) => {
  console.info(`Detected ${event} in ${filename}. Rebuilding browser js.`);
  buildFrontend();
});
console.info("Watching for changes in plugin directory.");
