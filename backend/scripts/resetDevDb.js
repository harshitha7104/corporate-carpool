// Development only: delete the embedded PostgreSQL data and uploaded files so
// the next start migrates and seeds from scratch. Never touches DATABASE_URL.
import fs from "node:fs";
import path from "node:path";
import { BACKEND_ROOT, config } from "../src/config.js";

if (config.isProduction || config.databaseUrl) {
  console.error("db:reset only clears the embedded development database. Unset DATABASE_URL to use it.");
  process.exit(1);
}
for (const dir of ["pg-dev", "uploads"]) {
  fs.rmSync(path.join(BACKEND_ROOT, ".data", dir), { recursive: true, force: true });
}
console.log("Development database and uploads cleared. Run npm start to recreate them with demo data.");
