import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Pages of the offline shell, read from public/sw.js so a new route is counted everywhere (sw.test.ts checks the list itself). */
const sw = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8")
export const SHELL_PAGES = (JSON.parse(/const SHELL = (\[[\s\S]*?\])/.exec(sw)![1].replace(/,\s*\]/, "]")) as string[]).length
