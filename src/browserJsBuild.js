import { watch } from "fs";

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
  });
await buildFrontend();
const watchFolder = `${import.meta.dir}/plugin`;
watch(watchFolder, { recursive: true }, (event, filename) => {
  console.log(`Detected ${event} in ${filename}. Rebuilding browser js.`);
  buildFrontend();
});
console.log("Watching for changes in plugin directory.");
