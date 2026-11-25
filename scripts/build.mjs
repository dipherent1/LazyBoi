// Builds the extension into dist/ and the playground harness into playground/harness/.
import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");
const dist = path.join(root, "dist");

const common = {
  bundle: true,
  format: "iife",
  target: "chrome114",
  sourcemap: "linked",
  logLevel: "info",
};

const builds = [
  { entryPoints: [path.join(root, "src/content/index.ts")], outfile: path.join(dist, "content.js") },
  { entryPoints: [path.join(root, "src/background/service-worker.ts")], outfile: path.join(dist, "service-worker.js") },
  { entryPoints: [path.join(root, "src/popup/popup.ts")], outfile: path.join(dist, "popup.js") },
  { entryPoints: [path.join(root, "src/harness.ts")], outfile: path.join(root, "playground/harness/lazyboi-harness.js") },
];

async function copyStatic() {
  await mkdir(dist, { recursive: true });
  await cp(path.join(root, "extension"), dist, { recursive: true });
}

await rm(dist, { recursive: true, force: true });
await copyStatic();

if (watch) {
  for (const b of builds) {
    const ctx = await context({ ...common, ...b });
    await ctx.watch();
  }
  console.log("Watching for changes… (static files in extension/ are copied once; restart to recopy)");
} else {
  await Promise.all(builds.map((b) => build({ ...common, ...b })));
  console.log(`Extension built to ${dist}`);
}
