import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { hmacHex, randomToken, safeEqual } from "../lib/util.js";

// Private local-disk storage. Files are written under random names outside
// any public directory and only served through short-lived signed links.
// Production on ephemeral hosts should swap this for object storage (S3/GCS)
// with server-side encryption; the interface stays the same.

const fullPath = (key) => path.join(config.storageDir, key.slice(0, 2), key);

export const storage = {
  async put(buffer) {
    const key = randomToken(24);
    const file = fullPath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer, { mode: 0o600 });
    return key;
  },
  read: (key) => fs.readFile(fullPath(key)),
  remove: (key) => fs.rm(fullPath(key), { force: true }),
};

// A link valid for `ttlSeconds`, bound to one viewer.
export const signFileLink = (fileId, viewerId, ttlSeconds = 300) => {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmacHex(config.sessionSecret, `${fileId}.${viewerId}.${exp}`);
  return `/api/v1/files/${fileId}?exp=${exp}&sig=${sig}`;
};

export const verifyFileLink = (fileId, viewerId, exp, sig) =>
  Number(exp) * 1000 > Date.now() && safeEqual(sig || "", hmacHex(config.sessionSecret, `${fileId}.${viewerId}.${exp}`));

// Check the leading bytes so a renamed executable cannot pass as a document.
export const sniffMime = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
};
