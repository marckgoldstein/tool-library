import { expect, type Page } from "@playwright/test";

export const USERS = {
  admin: "admin@example.test",
  owner: "olivia@example.test",
  borrower: "ben@example.test",
  other: "oscar@example.test",
};

/** Request a magic link, then follow it from the local mailbox (dev email transport). */
export async function signInAs(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page).toHaveURL(/\/sign-in\/check-email/);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const link = await latestLinkFor(page, email);
  await page.goto(link);
}

export async function latestLinkFor(page: Page, email: string): Promise<string> {
  await page.goto("/dev/mailbox");
  const mail = page.getByTestId("mail-item").filter({ hasText: `To: ${email}` }).first();
  await expect(mail).toBeVisible();
  const href = await mail.getByRole("link").first().getAttribute("href");
  if (!href) throw new Error(`No link in latest email to ${email}`);
  return href;
}
