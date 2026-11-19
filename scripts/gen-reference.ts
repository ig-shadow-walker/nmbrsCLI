/**
 * Writes skill/nmbrs/reference.md from the CLI's own command tree, so the skill can't drift from the code.
 *   bun run reference
 */
import { buildProgram } from "../src/cli.ts";
import { buildReference } from "../src/reference.ts";

const text = buildReference(buildProgram());
await Bun.write(new URL("../skill/nmbrs/reference.md", import.meta.url), text);
console.log(`Wrote skill/nmbrs/reference.md (${text.split("\n").length} lines)`);
