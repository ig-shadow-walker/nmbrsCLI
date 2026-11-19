import { existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import skillMd from "../skill/nmbrs/SKILL.md" with { type: "text" };
import { expandHome } from "./config.ts";
import { NmbrsError } from "./errors.ts";

export interface SkillInstall {
  dir: string;
  files: string[];
  /** installed: new; updated: replaced an earlier copy; linked: left a development symlink alone. */
  action: "installed" | "updated" | "linked";
}

/** Where Claude Code looks for this skill: $CLAUDE_SKILLS_DIR, else $CLAUDE_CONFIG_DIR/skills, else ~/.claude/skills. */
export function defaultSkillDir(env: Record<string, string | undefined> = process.env): string {
  const parent = env.CLAUDE_SKILLS_DIR || join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "skills");
  return join(resolve(expandHome(parent)), "nmbrs");
}

/**
 * Writes SKILL.md (bundled into the binary) and reference.md (generated from this binary's commands),
 * so the installed skill always matches the installed CLI.
 */
export function installSkill(reference: string, opts: { dir?: string; force?: boolean } = {}): SkillInstall {
  const dir = opts.dir ? resolve(expandHome(opts.dir)) : defaultSkillDir();
  let isLink = false;
  try {
    isLink = lstatSync(dir).isSymbolicLink();
  } catch {
    /* doesn't exist yet */
  }
  if (isLink && !opts.force) return { dir, files: [], action: "linked" };
  const existed = existsSync(dir) || isLink;
  if (isLink) rmSync(dir);
  if (existsSync(dir) && !lstatSync(dir).isDirectory()) {
    throw new NmbrsError(`${dir} exists and is not a folder; move it away and try again.`);
  }
  mkdirSync(dir, { recursive: true });
  const files = [join(dir, "SKILL.md"), join(dir, "reference.md")];
  writeFileSync(files[0]!, skillMd);
  writeFileSync(files[1]!, reference);
  return { dir, files, action: existed ? "updated" : "installed" };
}
