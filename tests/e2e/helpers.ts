import { expect, type BrowserContext, type Page } from "@playwright/test";

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

/** The header's More menu (native popover): open it, then return a locator inside it. */
export async function openMore(page: Page) {
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^More/ }).click();
  const menu = page.locator("#more-menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** A link in the main navigation (not a same-named link on the page). */
export const navLink = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true });

/** A 64×48 PNG made in memory, for photo uploads. */
export async function testPhoto(name = "photo.png") {
  const sharp = (await import("sharp")).default;
  const buffer = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 47, g: 107, b: 79 } } }).png().toBuffer();
  return { name, mimeType: "image/png", buffer };
}

/**
 * A brand-new member, made through the real join path (S1–S3): the admin
 * suggests and approves them, they join and sign in. Leaves them signed in.
 */
export async function joinNewMember(page: Page, context: BrowserContext, name: string, email: string) {
  await context.clearCookies();
  await signInAs(page, USERS.admin);
  await page.goto("/invite");
  await page.getByLabel("Their name").fill(name);
  await page.getByLabel("Their email address").fill(email);
  await page.getByRole("button", { name: "Suggest this person" }).click();
  await expect(page.getByTestId("suggest-result")).toContainText("Thanks.");
  await page.goto("/admin/invitations");
  await page
    .getByTestId("pending-suggestions")
    .getByRole("listitem")
    .filter({ hasText: email })
    .getByRole("button", { name: "Approve and send invite" })
    .click();
  await expect(page.getByTestId("admin-result")).toContainText("Approved.");
  await context.clearCookies();
  await page.goto(await latestLinkFor(page, email));
  await page.getByLabel("General area").fill("Maplewood");
  await page.getByLabel("I've read these notices and accept them").check();
  await page.getByRole("button", { name: "Join and email me a sign-in link" }).click();
  await expect(page).toHaveURL(/check-email\?joined=1/);
  await page.goto(await latestLinkFor(page, email));
  await expect(page.getByRole("heading", { name: `Welcome back, ${name}` })).toBeVisible();
}

export async function latestLinkFor(page: Page, email: string): Promise<string> {
  await page.goto("/dev/mailbox");
  const mail = page.getByTestId("mail-item").filter({ hasText: `To: ${email}` }).first();
  await expect(mail).toBeVisible();
  const href = await mail.getByRole("link").first().getAttribute("href");
  if (!href) throw new Error(`No link in latest email to ${email}`);
  return href;
}
