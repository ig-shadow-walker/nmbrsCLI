/**
 * Serves a folder over http, to try the installers against a local build without publishing anything:
 *   bun run build:release && bun run scripts/serve-release.ts dist/release 47812
 *   NMBRS_DOWNLOAD_URL=http://127.0.0.1:47812 sh install.sh --no-setup
 * Used by CI to test install.sh and install.ps1.
 */
import { join, normalize } from "node:path";

const [dir = "dist/release", port = "47812"] = process.argv.slice(2);
Bun.serve({
  port: Number(port),
  hostname: "127.0.0.1",
  async fetch(req) {
    const name = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^[\\/]+/, "");
    if (name.startsWith("..")) return new Response("not found", { status: 404 });
    const file = Bun.file(join(dir, name));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
console.log(`serving ${dir} on http://127.0.0.1:${port}`);
