// Generate docs/openapi.json from src/http/routes.js so the route list, the
// sign-in requirement and the permissions can't drift from the code.
// Run: npm run openapi
import fs from "node:fs";
import path from "node:path";
import { BACKEND_ROOT } from "../src/config.js";
import { SETTING_SCHEMAS } from "../src/services/settings.js";

const src = fs.readFileSync(path.join(BACKEND_ROOT, "src/http/routes.js"), "utf8");
const authFrom = src.indexOf("r.use(requireUser)");
const re = /\b([ra])\.(get|post|patch|put|delete)\("([^"]+)"([^\n]*?)async/g;
const paths = {};
let m;
while ((m = re.exec(src))) {
  const [, router, method, route, middle] = m;
  const full = `/api/v1${router === "a" ? "/admin" : ""}${route}`.replace(/:(\w+)/g, "{$1}");
  const perms = [...middle.matchAll(/requirePermission\(([^)]*)\)/g)].flatMap((p) => p[1].split(",").map((x) => x.trim().replace(/"/g, "")));
  const authed = router === "a" || m.index > authFrom;
  const params = [...full.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({ name, in: "path", required: true, schema: { type: "string" } }));
  const idempotent = /idem\(req\)/.test(src.slice(m.index, src.indexOf("\n  r.", m.index + 10)));
  paths[full] ||= {};
  paths[full][method] = {
    summary: `${method.toUpperCase()} ${route}`,
    tags: [full.split("/")[3] === "admin" ? "admin" : full.split("/")[3]],
    ...(params.length ? { parameters: params } : {}),
    ...(idempotent ? { "x-idempotency": "Send an Idempotency-Key header; a retry with the same key returns the original result." } : {}),
    security: authed ? [{ session: [] }] : [],
    ...(perms.length ? { "x-required-permissions": perms } : {}),
    responses: {
      200: { description: "Success" },
      ...(authed ? { 401: { $ref: "#/components/responses/Error" }, 403: { $ref: "#/components/responses/Error" } } : {}),
      404: { $ref: "#/components/responses/Error" },
      409: { $ref: "#/components/responses/Error" },
      422: { $ref: "#/components/responses/Error" },
      429: { $ref: "#/components/responses/Error" },
    },
  };
}
paths["/api/v1/payments/webhooks/{provider}"] = {
  post: {
    summary: "Signed payment-provider webhook",
    tags: ["payments"],
    parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string", enum: ["simulated", "razorpay"] } }],
    description: "Raw body. Verified with HMAC-SHA256 (x-razorpay-signature or x-simulated-signature). Duplicate events are acknowledged and ignored.",
    security: [],
    responses: { 200: { description: "Processed or duplicate" }, 403: { $ref: "#/components/responses/Error" } },
  },
};

const doc = {
  openapi: "3.1.0",
  info: { title: "Green Way API", version: "1.0.0", description: "Generated from backend/src/http/routes.js by scripts/openapi.js. Request and response bodies are described in docs/api.md; validation rules live in the Zod schemas in backend/src/services." },
  servers: [{ url: "http://localhost:4000" }],
  components: {
    securitySchemes: { session: { type: "apiKey", in: "cookie", name: "gw_session", description: "HttpOnly session cookie set by POST /api/v1/auth/otp/verify. State-changing requests also need a trusted Origin header." } },
    responses: {
      Error: {
        description: "Error",
        content: { "application/json": { schema: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: {} } } } } } },
      },
    },
    "x-config-keys": Object.keys(SETTING_SCHEMAS),
  },
  paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
};
const out = path.join(BACKEND_ROOT, "../docs/openapi.json");
fs.writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`Wrote ${Object.keys(doc.paths).length} paths (${Object.values(doc.paths).reduce((n, p) => n + Object.keys(p).length, 0)} operations) to docs/openapi.json`);
