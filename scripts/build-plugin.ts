import { resolve } from "path";

const projectRoot = resolve(import.meta.dir, "..");
const entryPoint = resolve(projectRoot, "src/mcp-server-entry.ts");
const outfile = resolve(projectRoot, "dist/mcp-server.bundle.js");

const result = await Bun.build({
  entrypoints: [entryPoint],
  outdir: resolve(projectRoot, "dist"),
  naming: "mcp-server.bundle.js",
  target: "bun",
  minify: false,
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Built: ${outfile}`);
