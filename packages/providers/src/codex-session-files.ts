import { createHash } from "node:crypto";
import { closeSync, lstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

export interface FileCursor {
  path: string;
  mtimeMs: number;
  offset: number;
  lastTotalTokens: number | null;
}

export interface ReadSlice {
  text: string;
  nextOffset: number;
  mtimeMs: number;
  previousTotal: number | null;
}

const FIRST_LINE_CHUNK = 64 * 1024;
const FIRST_LINE_LIMIT = 4 * 1024 * 1024;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type HashRead = { failed: true } | { failed: false; hash: string | null };

/**
 * SHA-256 of `tokens.account_id` in `<home>/auth.json`. Nothing else from the file is kept.
 * A missing file is no hash; any other read or parse failure is `failed`.
 */
export function codexAccountIdHash(homePath: string): HashRead {
  let raw: string;
  try {
    raw = readFileSync(join(homePath, "auth.json"), "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { failed: false, hash: null };
    console.error(JSON.stringify({ event: "codex_account_id_unreadable", code: errorCode(error) }));
    return { failed: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(JSON.stringify({ event: "codex_account_id_unreadable", code: "SYNTAX" }));
    return { failed: true };
  }
  const tokens = isRecord(parsed) && isRecord(parsed.tokens) ? parsed.tokens : null;
  const id = tokens && typeof tokens.account_id === "string" && tokens.account_id ? tokens.account_id : null;
  return { failed: false, hash: id ? sha256(id) : null };
}

/** SHA-256 of `session_meta.payload.creator_account_id` on the file's first line, if present. */
export function sessionCreatorHash(path: string): HashRead {
  const line = readFirstLine(path);
  if (line === false) return { failed: true };
  if (!line) return { failed: false, hash: null };
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return { failed: false, hash: null };
  }
  if (!isRecord(record) || record.type !== "session_meta" || !isRecord(record.payload)) {
    return { failed: false, hash: null };
  }
  const creator = record.payload.creator_account_id;
  return { failed: false, hash: typeof creator === "string" && creator ? sha256(creator) : null };
}

// The first line, null when there is none yet, or false when the file cannot be read or the
// line is longer than the read limit.
function readFirstLine(path: string): string | null | false {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const chunks: Buffer[] = [];
    let position = 0;
    while (position < FIRST_LINE_LIMIT) {
      const buffer = Buffer.alloc(FIRST_LINE_CHUNK);
      const read = readSync(fd, buffer, 0, FIRST_LINE_CHUNK, position);
      if (read <= 0) return null;
      const chunk = buffer.subarray(0, read);
      const newline = chunk.indexOf(0x0a);
      if (newline >= 0) {
        chunks.push(chunk.subarray(0, newline));
        return Buffer.concat(chunks).toString("utf8");
      }
      chunks.push(chunk);
      position += read;
    }
    console.error(JSON.stringify({ event: "codex_session_first_line_too_long", limitBytes: FIRST_LINE_LIMIT }));
    return false;
  } catch (error) {
    logReadFailure(error);
    return false;
  } finally {
    if (fd != null) closeSync(fd);
  }
}

export function readNewText(
  path: string,
  cursor: FileCursor | null,
  rescan: boolean,
): { failed: true } | { failed: false; slice: ReadSlice | null } {
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    logReadFailure(error);
    return { failed: true };
  }
  const mtimeMs = Math.trunc(stat.mtimeMs);
  const size = stat.size;
  if (!rescan && cursor && cursor.offset === size && cursor.mtimeMs === mtimeMs) return { failed: false, slice: null };
  const start = !rescan && cursor && size >= cursor.offset ? cursor.offset : 0;
  const previousTotal = start === 0 ? null : cursor?.lastTotalTokens ?? null;
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const length = size - start;
    if (length <= 0) return { failed: false, slice: { text: "", nextOffset: start, mtimeMs, previousTotal } };
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, start);
    const slice = buffer.subarray(0, read);
    let end = slice.length;
    if (end === 0 || slice[end - 1] !== 0x0a) {
      const newline = slice.lastIndexOf(0x0a);
      if (newline < 0) return { failed: false, slice: { text: "", nextOffset: start, mtimeMs, previousTotal } };
      end = newline + 1;
    }
    return {
      failed: false,
      slice: { text: slice.subarray(0, end).toString("utf8"), nextOffset: start + end, mtimeMs, previousTotal },
    };
  } catch (error) {
    logReadFailure(error);
    return { failed: true };
  } finally {
    if (fd != null) closeSync(fd);
  }
}

export function listJsonl(root: string): { files: string[]; complete: boolean } {
  const files: string[] = [];
  const stack = [root];
  let complete = true;
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (error) {
      complete = false;
      logReadFailure(error);
      continue;
    }
    for (const name of names) {
      const path = join(dir, name);
      let stat;
      try {
        stat = lstatSync(path);
      } catch (error) {
        complete = false;
        logReadFailure(error);
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) stack.push(path);
      else if (stat.isFile() && name.endsWith(".jsonl")) files.push(path);
    }
  }
  files.sort();
  return { files, complete };
}

export function logReadFailure(error: unknown): void {
  console.error(JSON.stringify({ event: "codex_session_read_failed", code: errorCode(error) }));
}

export function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
