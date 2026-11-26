import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PhotoError, processPhoto, readPhoto, savePhoto } from "@/server/storage/photos";

async function jpegWithGps() {
  return sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#c84" } })
    .jpeg()
    .withExif({ IFD0: { Make: "TestCam" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 44/1 0/1" } })
    .toBuffer();
}

describe("photo processing (D32)", () => {
  it("resizes to fit 1600px and strips EXIF including location", async () => {
    const input = await jpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await processPhoto(input, "image/jpeg");
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width!, meta.height!)).toBe(1600);
    expect(meta.exif).toBeUndefined();
  });

  it("rejects unsupported types and unreadable files", async () => {
    await expect(processPhoto(Buffer.from("hi"), "text/plain")).rejects.toBeInstanceOf(PhotoError);
    await expect(processPhoto(Buffer.from("not an image"), "image/png")).rejects.toThrow(/couldn't be read/);
  });

  it("saves and reads back by key, refusing path tricks", async () => {
    const out = await processPhoto(await jpegWithGps(), "image/jpeg");
    const key = await savePhoto(out, "items");
    expect(key).toMatch(/^items\/[0-9a-f-]+\.webp$/);
    expect((await readPhoto(key))?.byteLength).toBe(out.byteLength);
    expect(await readPhoto("../../etc/passwd")).toBeNull();
  });
});
