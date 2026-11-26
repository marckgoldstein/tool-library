import { config } from "dotenv";

/** Fresh, seeded test database before the browser tests run. */
export default async function globalSetup() {
  config({ path: ".env.test", override: true, quiet: true });
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  await pool.end();
  const { seed } = await import("../../src/db/seed");
  const { pool: appPool } = await import("../../src/db");
  const result = await seed();
  process.env.E2E_OVERDUE_LOAN_ID = result.loans.overdue.id;
  await appPool.end();
}
