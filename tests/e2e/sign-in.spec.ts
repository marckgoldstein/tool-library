import { expect, test } from "@playwright/test";
import { latestLinkFor, openMore, signInAs, USERS } from "./helpers";

test.describe("magic-link sign-in (T4, D7, D27)", () => {
  test("a member signs in from the emailed link and signs out", async ({ page }) => {
    await signInAs(page, USERS.owner);
    await expect(page.getByRole("heading", { name: "Welcome back, Olivia" })).toBeVisible();
    await expect(page.getByText("Friends & Family", { exact: true })).toBeVisible();
    await (await openMore(page)).getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  });

  test("an unknown address sees the same page but gets no email", async ({ page }) => {
    const stranger = `stranger-${Date.now()}@example.test`;
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(stranger);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page).toHaveURL(/\/sign-in\/check-email/);
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await page.goto("/dev/mailbox");
    await expect(page.getByText(`To: ${stranger}`)).toHaveCount(0);
  });

  test("the browser blocks an invalid address before submitting", async ({ page }) => {
    await page.goto("/sign-in");
    const input = page.getByLabel("Email address");
    await input.fill("not-an-email");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    expect(await input.evaluate((el: HTMLInputElement) => el.validity.typeMismatch)).toBe(true);
  });

  test("a link works only once", async ({ page, context }) => {
    await signInAs(page, USERS.borrower);
    const used = await latestLinkFor(page, USERS.borrower);
    await context.clearCookies();
    await page.goto(used);
    await expect(page.getByRole("heading", { name: /expired or was already used/ })).toBeVisible();
  });

  test("sign-in form follows form best practice", async ({ page }) => {
    await page.goto("/sign-in");
    const input = page.getByLabel("Email address");
    await expect(input).toHaveAttribute("type", "email");
    await expect(input).toHaveAttribute("autocomplete", "email");
    await expect(input).toHaveAttribute("required", "");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  });
});
