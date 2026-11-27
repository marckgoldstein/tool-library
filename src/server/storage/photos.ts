/**
 * Photo storage (T6, D32). Uploads are resized and re-encoded, which drops
 * EXIF data (including GPS location). Two drivers:
 *  - "local": files under .data/uploads, served by /media/... (development and tests)
 *  - "r2":    Cloudflare R2 or any S3-compatible bucket (added with hosting, T1)
 */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB per photo
const MAX_EDGE_PX = 1600;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

const LOCAL_ROOT = path.resolve(process.cwd(), ".data/uploads");

export class PhotoError extends Error {}

/** Resize to fit 1600px, honour the camera's rotation, strip all metadata, encode as WebP. */
export async function processPhoto(input: Buffer, mimeType: string): Promise<Buffer> {
  if (!ACCEPTED.has(mimeType)) throw new PhotoError("Use a JPEG, PNG, WebP or HEIC photo.");
  if (input.byteLength > MAX_UPLOAD_BYTES) throw new PhotoError("Photos must be 10 MB or smaller.");
  try {
    return await sharp(input, { failOn: "error" })
      .rotate() // apply EXIF orientation before the metadata is dropped
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer(); // sharp drops EXIF/XMP/ICC unless asked to keep them
  } catch {
    throw new PhotoError("That file couldn't be read as a photo.");
  }
}

function driver() {
  const value = process.env.STORAGE_DRIVER ?? "local";
  if (value !== "local") throw new Error(`STORAGE_DRIVER "${value}" is not configured yet (pending hosting, T1).`);
  return value;
}

const safeKey = (key: string) => {
  if (!/^[a-z0-9/_-]+\.webp$/.test(key) || key.includes("..")) throw new PhotoError("Bad photo key.");
  return key;
};

/** Store a processed photo and return its storage key. */
export async function savePhoto(processed: Buffer, prefix: "items" | "profiles"): Promise<string> {
  driver();
  const key = `${prefix}/${crypto.randomUUID()}.webp`;
  const file = path.join(LOCAL_ROOT, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, processed);
  return key;
}

export async function readPhoto(key: string): Promise<Buffer | null> {
  driver();
  try {
    return await readFile(path.join(LOCAL_ROOT, safeKey(key)));
  } catch {
    return null;
  }
}

/** Remove a stored photo (account deletion). A missing file is fine. */
export async function deletePhoto(key: string): Promise<void> {
  driver();
  await unlink(path.join(LOCAL_ROOT, safeKey(key))).catch(() => undefined);
}

export const photoUrl = (key: string) => `/media/${safeKey(key)}`;
