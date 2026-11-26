import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

config({ path: ".env.test", override: true, quiet: true });

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    // Tests share one Postgres database, so run files one at a time.
    fileParallelism: false,
    env: { ...process.env } as Record<string, string>,
  },
});
