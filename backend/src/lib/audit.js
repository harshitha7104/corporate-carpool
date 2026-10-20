import { using } from "../db/index.js";
import { requestContext } from "./logger.js";

// Record a privileged or safety-relevant action. Pass the transaction client
// when the action is part of one, so the log commits or rolls back with it.
export const audit = async ({ actor, action, entityType, entityId, details = {}, client }) => {
  const ctx = requestContext.getStore();
  await using(client).query(
    `INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, details, ip, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      actor?.id || null,
      actor?.primaryRole || (actor ? "user" : "system"),
      action,
      entityType,
      entityId ? String(entityId) : null,
      details,
      ctx?.ip || null,
      ctx?.requestId || null,
    ]
  );
};
