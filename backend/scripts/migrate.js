// Apply pending migrations to DATABASE_URL (or the embedded dev database).
import { config } from "../src/config.js";
import { closePool, initPool } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";

let dev;
let url = config.databaseUrl;
if (!url) {
  const { startDevDatabase } = await import("../src/db/devServer.js");
  dev = await startDevDatabase({ name: "dev" });
  url = dev.url;
}
initPool(url);
await migrate();
console.log("Migrations are up to date.");
await closePool();
if (dev) await dev.stop();
