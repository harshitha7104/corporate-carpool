import { db } from "../db/index.js";
import { storage } from "../providers/storage.js";

// Delete stored documents whose retention date has passed (for example after
// an account is deleted). The database row stays, marked deleted, so audit
// history still resolves.
export const purgeExpiredFiles = async () => {
  const due = await db.many("SELECT id, storage_key FROM files WHERE retention_until <= now() AND deleted_at IS NULL LIMIT 100");
  for (const f of due) {
    await storage.remove(f.storage_key);
    await db.query("UPDATE files SET deleted_at = now() WHERE id = $1", [f.id]);
  }
  return due.length;
};
