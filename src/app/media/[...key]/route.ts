import { auth } from "@/auth";
import { readPhoto } from "@/server/storage/photos";

/** Serves locally stored photos to signed-in members (local driver only). */
export async function GET(_request: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Not found", { status: 404 });
  const { key } = await ctx.params;
  const body = await readPhoto(key.join("/")).catch(() => null);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=3600" },
  });
}
