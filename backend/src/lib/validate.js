import { z } from "zod";
import { validationError } from "./errors.js";

// Parse with a Zod schema or throw a 422 listing each invalid field.
export const parse = (schema, value) => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw validationError(
      result.error.issues.map((i) => ({ field: i.path.join(".") || "(body)", message: i.message }))
    );
  }
  return result.data;
};

export const point = z.object({
  label: z.string().trim().min(2).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const uuid = z.string().uuid();

export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

export const indianPhone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .refine((v) => /^(\+91|91|0)?[6-9]\d{9}$/.test(v), "Enter a 10-digit Indian mobile number.");
