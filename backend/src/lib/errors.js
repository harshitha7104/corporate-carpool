// Every API error has the shape { error: { code, message, details? } }.
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, "bad_request", message, details);
export const validationError = (details) =>
  new AppError(422, "validation_failed", "Some fields are missing or invalid.", details);
export const unauthorized = (message = "Please sign in to continue.") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "You do not have permission to do that.") => new AppError(403, "forbidden", message);
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found.`);
export const conflict = (code, message, details) => new AppError(409, code, message, details);
export const tooManyRequests = (message = "Too many attempts. Please wait and try again.") =>
  new AppError(429, "rate_limited", message);
export const unavailable = (message) => new AppError(503, "unavailable", message);
