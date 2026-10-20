// Syntax-check every backend module (no third-party linter needed).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []);
const files = ["src", "scripts", "test"].filter(fs.existsSync).flatMap(walk);
let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (err) {
    failed += 1;
    console.error(String(err.stderr));
  }
}
console.log(`${files.length - failed}/${files.length} files passed syntax check.`);
process.exit(failed ? 1 : 0);
