// Load the fictional demo data into an empty database. Refuses to run in
// production unless SEED_DEMO=true is set deliberately.
import { config } from "../src/config.js";
import { closePool, initPool } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";
import { seedIfEmpty } from "../src/db/seed.js";

if (config.isProduction && !config.seedDemo) {
  console.error("Refusing to seed demo data in production without SEED_DEMO=true.");
  process.exit(1);
}
let dev;
let url = config.databaseUrl;
if (!url) {
  const { startDevDatabase } = await import("../src/db/devServer.js");
  dev = await startDevDatabase({ name: "dev" });
  url = dev.url;
}
initPool(url);
await migrate();
console.log((await seedIfEmpty()) ? "Demo data loaded." : "The database already has users; nothing seeded.");
await closePool();
if (dev) await dev.stop();
