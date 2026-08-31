import { dirname, join } from "path";
import { mkdirSync, writeFileSync } from "fs";

/** Writable on Vercel lambdas; local/dev uses repo `.data`. */
export function dataDir() {
  if (process.env.VERCEL) return join("/tmp", "shortlist-data");
  return join(process.cwd(), ".data");
}

export function writeJsonFile(file: string, data: unknown) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data));
  } catch {
    /* read-only deploy FS — in-memory maps still hold the value */
  }
}
