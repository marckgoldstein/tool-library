/**
 * T23: search speed with pilot-sized data (PRD section 8: under 500 ms at p95).
 * Run: npx tsx tests/perf/search-timing.ts
 * Uses the TEST database (.env.test) and empties it first, like the unit tests.
 */
import { config } from "dotenv";
config({ path: ".env.test", override: true, quiet: true });

const MEMBERS = 60;
const ITEMS = 600;
const RUNS = 60;

async function main() {
  const { db, pool } = await import("../../src/db");
  const schema = await import("../../src/db/schema");
  const { searchItems } = await import("../../src/server/items/service");
  const { resetDb } = await import("../support/factories");
  const { STARTER_CATEGORIES } = await import("../../src/content/categories");

  await resetDb();
  const [group] = await db.insert(schema.communities).values({ name: "Perf group" }).returning();
  const members = await db
    .insert(schema.users)
    .values(Array.from({ length: MEMBERS }, (_, i) => ({ email: `perf${i}@example.test`, name: `Member ${i}`, generalArea: "Maplewood" })))
    .returning({ id: schema.users.id });
  await db.insert(schema.memberships).values(members.map((m) => ({ userId: m.id, communityId: group!.id })));
  const cats: { id: string; name: string }[] = [];
  for (const top of STARTER_CATEGORIES) {
    const [parent] = await db.insert(schema.categories).values({ name: top.name }).returning();
    cats.push(parent!);
    for (const child of top.children) {
      const [c] = await db.insert(schema.categories).values({ name: child, parentId: parent!.id }).returning();
      cats.push(c!);
    }
  }
  const nouns = ["drill", "saw", "ladder", "tent", "cooler", "sander", "projector", "speaker", "mower", "washer", "clamp", "wrench", "table", "grill", "kayak"];
  const adjectives = ["cordless", "heavy-duty", "compact", "folding", "electric", "portable", "large", "small", "vintage", "new"];
  const rows = Array.from({ length: ITEMS }, (_, i) => {
    const noun = nouns[i % nouns.length]!;
    const adj = adjectives[(i * 7) % adjectives.length]!;
    return {
      ownerId: members[i % MEMBERS]!.id,
      communityId: group!.id,
      categoryId: cats[i % cats.length]!.id,
      title: `${adj} ${noun} ${i}`,
      description: `A ${adj} ${noun} in good shape. Comes with a case, spare parts and instructions. Item number ${i}.`,
      condition: "Good",
      status: (i % 10 === 0 ? "paused" : "available") as "paused" | "available",
    };
  });
  await db.insert(schema.items).values(rows);
  await db.execute("ANALYZE item" as never);

  const viewer = members[0]!.id;
  const queries = [
    { q: "drill" },
    { q: "cordless saw" },
    { q: "tent" },
    { q: "portable speaker" },
    { q: "camping" },
    { q: "" },
    { q: "", categoryId: cats[0]!.id },
    { q: "spare parts" },
    { q: "nothing matches this" },
  ];
  for (const q of queries) await searchItems(viewer, q); // warm up
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const q = queries[i % queries.length]!;
    const t = performance.now();
    await searchItems(viewer, q);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const pct = (p: number) => times[Math.min(times.length - 1, Math.ceil((p / 100) * times.length) - 1)]!;
  console.log(JSON.stringify({ members: MEMBERS, items: ITEMS, runs: RUNS, p50_ms: +pct(50).toFixed(1), p95_ms: +pct(95).toFixed(1), max_ms: +times.at(-1)!.toFixed(1), target_ms: 500 }));
  await resetDb();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
