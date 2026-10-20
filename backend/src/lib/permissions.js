// Explicit permission lists per role. Admins get a named list too, rather
// than a wildcard, so every privileged capability is reviewable here.
export const ROLE_PERMISSIONS = {
  passenger: [],
  driver: ["rides.manage_own", "vehicles.manage_own"],
  support: [
    "support.tickets.read_assigned",
    "support.tickets.read_queue",
    "support.tickets.work",
    "support.tickets.escalate",
    "support.case_context.read",
  ],
  admin: [
    "admin.metrics.read",
    "admin.users.read",
    "admin.users.manage",
    "admin.roles.manage",
    "admin.verifications.review",
    "admin.rides.read",
    "admin.bookings.read",
    "admin.safety.manage",
    "admin.payments.read",
    "admin.refunds.issue",
    "admin.config.manage",
    "admin.audit.read",
    "admin.exports.run",
    "admin.health.read",
    "support.tickets.read_assigned",
    "support.tickets.read_queue",
    "support.tickets.read_all",
    "support.tickets.assign",
    "support.tickets.work",
    "support.tickets.escalate",
    "support.case_context.read",
  ],
};

export const permissionsFor = (roles) => [...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] || []))];

export const primaryRole = (roles) =>
  ["admin", "support", "driver", "passenger"].find((r) => roles.includes(r)) || "passenger";
