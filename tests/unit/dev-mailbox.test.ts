import { afterEach, describe, expect, it, vi } from "vitest";
import { devMailboxEnabled } from "@/server/email/dev-mailbox";

afterEach(() => vi.unstubAllEnvs());

describe("dev mailbox guard", () => {
  it("is off in production unless explicitly enabled for tests", () => {
    vi.stubEnv("EMAIL_TRANSPORT", "dev");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_DEV_MAILBOX", "");
    expect(devMailboxEnabled()).toBe(false);
    vi.stubEnv("ENABLE_DEV_MAILBOX", "1");
    expect(devMailboxEnabled()).toBe(true);
  });

  it("is always off with a real email transport", () => {
    vi.stubEnv("EMAIL_TRANSPORT", "resend");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_DEV_MAILBOX", "1");
    expect(devMailboxEnabled()).toBe(false);
  });
});
