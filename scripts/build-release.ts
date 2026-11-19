/**
 * Builds the files for a GitHub release into dist/release: one binary per platform, install.sh,
 * install.ps1 and SHA256SUMS. Nothing is uploaded: the Release workflow (.github/workflows/release.yml)
 * runs this on GitHub when started by hand and attaches the files to the release.
 *
 *   bun run build:release            # all platforms
 *   bun run build:release darwin     # only names containing "darwin"
 */
import { $ } from "bun";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };

/** Asset name (what install.sh asks for) -> Bun compile target. x64 uses baseline builds so older CPUs work too. */
const TARGETS: Record<string, string> = {
  "nmbrs-darwin-arm64": "bun-darwin-arm64",
  "nmbrs-darwin-x64": "bun-darwin-x64-baseline",
  "nmbrs-linux-arm64": "bun-linux-arm64",
  "nmbrs-linux-x64": "bun-linux-x64-baseline",
  "nmbrs-linux-arm64-musl": "bun-linux-arm64-musl",
  "nmbrs-linux-x64-musl": "bun-linux-x64-musl-baseline",
  "nmbrs-windows-x64.exe": "bun-windows-x64-baseline",
  "nmbrs-windows-arm64.exe": "bun-windows-arm64",
};

const INSTALLERS = ["install.sh", "install.ps1"];

const filter = process.argv[2];
// fileURLToPath, not URL.pathname: on Windows the latter gives "/D:/..." which is not a path.
const out = fileURLToPath(new URL("../dist/release/", import.meta.url));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const names = Object.keys(TARGETS).filter((n) => !filter || n.includes(filter));
for (const name of names) {
  console.log(`building ${name} (${TARGETS[name]})`);
  await $`bun build src/cli.ts --compile --minify --no-compile-autoload-dotenv --target=${TARGETS[name]!} --outfile ${join(out, name)}`.quiet();
}
for (const f of INSTALLERS) await $`cp ${f} ${join(out, f)}`;

const sums: string[] = [];
for (const name of [...names, ...INSTALLERS]) {
  const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(join(out, name)).arrayBuffer()).digest("hex");
  sums.push(`${hash}  ${name}`);
}
await Bun.write(join(out, "SHA256SUMS"), sums.join("\n") + "\n");
console.log(`\nnmbrs ${pkg.version}: ${names.length} binaries, installers and SHA256SUMS in dist/release/`);
console.log(
  `To publish: push, create a GitHub release tagged v${pkg.version} and attach every file in dist/release/ ` +
    `(or: gh release create v${pkg.version} dist/release/* --title v${pkg.version} --notes-file CHANGELOG.md). ` +
    `The Release workflow (Actions > Release > Run workflow) can do the build and upload instead.`,
);
