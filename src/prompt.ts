import { readSync, writeSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { Exit, NmbrsError } from "./errors.ts";

export interface AskOptions {
  /** Shown in brackets; returned when the answer is empty. */
  default?: string;
  /** Echo * instead of the typed characters. */
  secret?: boolean;
  /** Ask again until the answer isn't empty. */
  required?: boolean;
}

/** What the setup wizard needs from a terminal. Tests pass a scripted one. */
export interface Prompter {
  readonly interactive: boolean;
  say(text?: string): void;
  ask(question: string, opts?: AskOptions): Promise<string>;
  confirm(question: string, defaultYes: boolean): Promise<boolean>;
}

const YES = new Set(["y", "yes", "j", "ja"]);
const NO = new Set(["n", "no", "nee"]);

/** Typed-ahead input after the last answered line (pasted or typed fast), kept for the next question. */
let pending = "";

function write(text: string): void {
  writeSync(2, text);
}

/** This terminal can't do hidden input; say how to set up without it. */
function noTerminal(e: unknown): NmbrsError {
  return new NmbrsError(`This terminal can't read the answers (${(e as Error).message}).`, Exit.ERROR, {
    key: "setup.no_terminal",
    hint:
      "Pipe the secret in instead: `nmbrs setup --client-id <id> --client-secret-stdin`, e.g. with the secret on " +
      "the clipboard: `pbpaste | …` (macOS) or `Get-Clipboard | …` (Windows PowerShell).",
  });
}

/** One blocking read from the terminal. Retries when stdin was left non-blocking. */
function readChunk(buf: Buffer, decoder: StringDecoder): string {
  for (;;) {
    try {
      const n = readSync(0, buf, 0, buf.length, null);
      if (n === 0) return "\u0004"; // end of input: same as Ctrl-D
      return decoder.write(buf.subarray(0, n));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EAGAIN" || code === "EWOULDBLOCK") {
        Bun.sleepSync(15);
        continue;
      }
      throw e;
    }
  }
}

/**
 * Reads one line from the terminal in raw mode, with blocking reads. Async stdin reading can't be used:
 * on macOS it spins on /dev/tty, which is where `curl … | sh` installers take the keyboard from.
 * Doing it by hand also lets visible and hidden input share one reader, handles pasted text and
 * backspace, and ignores arrow keys and paste markers.
 */
function readLine(question: string, secret: boolean): string {
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  // Raw mode before the prompt shows, so nothing typed (or pasted) right away is echoed in the clear.
  try {
    stdin.setRawMode(true);
  } catch (e) {
    throw noTerminal(e);
  }
  write(question);
  const raw = Buffer.alloc(1024);
  const decoder = new StringDecoder("utf8");
  let line = "";
  try {
    for (;;) {
      let chunk: string;
      try {
        chunk = pending || readChunk(raw, decoder);
      } catch (e) {
        throw noTerminal(e);
      }
      pending = "";
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i]!;
        if (ch === "\r" || ch === "\n") {
          const rest = chunk.slice(i + 1);
          pending = ch === "\r" && rest.startsWith("\n") ? rest.slice(1) : rest;
          return line;
        }
        if (ch === "\u0003" || (ch === "\u0004" && line === "")) {
          throw new NmbrsError("Setup cancelled; nothing was saved.", Exit.ERROR, { key: "setup.cancelled" });
        }
        if (ch === "\u007f" || ch === "\b") {
          if (line) {
            line = [...line].slice(0, -1).join("");
            write("\b \b");
          }
          continue;
        }
        if (ch === "\u001b") {
          const seq = chunk.slice(i).match(/^\u001b(?:\[[0-9;?]*[A-Za-z~]|O[A-Za-z]|.)?/)![0];
          i += seq.length - 1;
          continue;
        }
        if (ch < " ") continue;
        line += ch;
        write(secret ? "*" : ch);
      }
    }
  } finally {
    stdin.setRawMode(wasRaw);
    write("\n");
  }
}

export function terminalPrompter(): Prompter {
  return {
    interactive: true,
    say: (text = "") => write(text + "\n"),
    async ask(question, opts = {}) {
      const label = opts.default && !opts.secret ? `${question} [${opts.default}]: ` : `${question}: `;
      for (;;) {
        const answer = readLine(label, !!opts.secret).trim();
        if (answer) return answer;
        if (opts.default) return opts.default;
        if (!opts.required) return "";
      }
    },
    async confirm(question, defaultYes) {
      for (;;) {
        const answer = readLine(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `, false).trim().toLowerCase();
        if (!answer) return defaultYes;
        if (YES.has(answer)) return true;
        if (NO.has(answer)) return false;
      }
    },
  };
}

/** For non-interactive runs: questions are errors, confirmations take their default. */
export function silentPrompter(say: (text: string) => void = () => {}): Prompter {
  return {
    interactive: false,
    say: (text = "") => say(text),
    async ask(question) {
      throw new NmbrsError(`${question} is needed, but setup is running without a terminal.`, Exit.ERROR, {
        key: "setup.needs_input",
        hint: "Run `nmbrs setup` in a terminal, or pass --client-id and --client-secret-stdin.",
      });
    },
    async confirm(_q, defaultYes) {
      return defaultYes;
    },
  };
}
