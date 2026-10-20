import { z } from "zod";
import { db } from "../db/index.js";
import { audit } from "../lib/audit.js";
import { conflict, notFound } from "../lib/errors.js";
import { normalisePlate } from "../lib/util.js";
import { parse } from "../lib/validate.js";
import { vehicleVerificationStatus } from "./verification.js";

const vehicleSchema = z.object({
  make: z.string().trim().min(2).max(40),
  model: z.string().trim().min(1).max(40),
  color: z.string().trim().min(3).max(30),
  plateNumber: z
    .string()
    .transform(normalisePlate)
    .refine((v) => /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}$/.test(v), "Enter a registration number like KA 01 AB 1234."),
  seats: z.number().int().min(1, "At least one passenger seat.").max(7),
  fuelType: z.enum(["petrol", "diesel", "cng", "electric", "hybrid"]).optional(),
  year: z.number().int().min(1990).max(new Date().getFullYear() + 1).optional(),
});

const shape = async (v) => ({
  id: v.id,
  make: v.make,
  model: v.model,
  color: v.color,
  plateNumber: v.plate_number,
  seats: v.seats,
  fuelType: v.fuel_type,
  year: v.year,
  isDemo: v.is_demo,
  verification: await vehicleVerificationStatus(v.id),
});

export const listVehicles = async (user) => {
  const rows = await db.many("SELECT * FROM vehicles WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY created_at", [user.id]);
  return Promise.all(rows.map(shape));
};

export const getOwnVehicle = async (user, id, client = db) => {
  const v = await client.one("SELECT * FROM vehicles WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [id, user.id]);
  if (!v) throw notFound("Vehicle");
  return v;
};

export const addVehicle = async (user, body) => {
  const input = parse(vehicleSchema, body);
  const { count } = await db.one("SELECT count(*) FROM vehicles WHERE owner_id = $1 AND deleted_at IS NULL", [user.id]);
  if (count >= 5) throw conflict("vehicle_limit", "You can register up to 5 vehicles.");
  try {
    const v = await db.one(
      `INSERT INTO vehicles (owner_id, make, model, color, plate_number, seats, fuel_type, year)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [user.id, input.make, input.model, input.color, input.plateNumber, input.seats, input.fuelType || null, input.year || null]
    );
    await audit({ actor: user, action: "vehicle.add", entityType: "vehicle", entityId: v.id });
    return shape(v);
  } catch (err) {
    if (err.code === "23505") throw conflict("plate_taken", "That registration number is already registered.");
    throw err;
  }
};

export const updateVehicle = async (user, id, body) => {
  const current = await getOwnVehicle(user, id);
  const input = parse(vehicleSchema.partial(), body);
  const next = { ...current, ...Object.fromEntries(Object.entries({
    make: input.make, model: input.model, color: input.color, plate_number: input.plateNumber,
    seats: input.seats, fuel_type: input.fuelType, year: input.year,
  }).filter(([, v]) => v !== undefined)) };
  const identityChanged = next.plate_number !== current.plate_number || next.make !== current.make || next.model !== current.model;
  const v = await db.one(
    `UPDATE vehicles SET make = $2, model = $3, color = $4, plate_number = $5, seats = $6, fuel_type = $7, year = $8, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, next.make, next.model, next.color, next.plate_number, next.seats, next.fuel_type, next.year]
  );
  // Changing what the documents describe invalidates the earlier review.
  if (identityChanged) {
    await db.query("UPDATE vehicle_verifications SET status = 'expired' WHERE vehicle_id = $1 AND status IN ('verified','pending_review')", [id]);
  }
  await audit({ actor: user, action: "vehicle.update", entityType: "vehicle", entityId: id, details: { identityChanged } });
  return shape(v);
};

export const removeVehicle = async (user, id) => {
  await getOwnVehicle(user, id);
  const busy = await db.one("SELECT 1 FROM rides WHERE vehicle_id = $1 AND status IN ('published','in_progress')", [id]);
  if (busy) throw conflict("vehicle_in_use", "This vehicle has upcoming rides. Cancel them first.");
  await db.query("UPDATE vehicles SET deleted_at = now() WHERE id = $1", [id]);
};
