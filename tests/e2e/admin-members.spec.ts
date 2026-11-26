import { expect, test } from "@playwright/test";
import { joinNewMember, latestLinkFor, openMore, signInAs, USERS } from "./helpers";

test.describe("M2 admin: second admin and removing a member (T9, S6)", () => {
  test("the admin makes a member an admin, steps them back, then removes them", async ({ page, context }, info) => {
    const stamp = `${info.project.name}-${Date.now()}`;
    const name = `Rae ${stamp}`;
    const email = `rae-${stamp}@example.test`;
    await joinNewMember(page, context, name, email);

    // Members don't see or reach the admin pages.
    const memberMenu = await openMore(page);
    await expect(memberMenu.getByRole("link", { name: "Members", exact: true })).toHaveCount(0);
    expect((await page.goto("/admin/members"))?.status()).toBe(404);

    await context.clearCookies();
    await signInAs(page, USERS.admin);
    await (await openMore(page)).getByRole("link", { name: "Members", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
    const row = () => page.getByTestId("active-members").getByRole("listitem").filter({ hasText: email });

    // T9: granting admin rights asks first and says what admins can see (Impeccable review).
    await row().getByRole("button", { name: "Make admin…" }).click();
    const promote = page.getByRole("dialog", { name: `Make ${name} an admin?` });
    await expect(promote).toContainText("Admins see every member's email address");
    await promote.getByRole("button", { name: `Keep ${name} as a member` }).click();
    await expect(promote).toBeHidden();
    await row().getByRole("button", { name: "Make admin…" }).click();
    await promote.getByRole("button", { name: `Make ${name} an admin` }).click();
    await expect(page.getByTestId("members-result")).toContainText("They're now an admin.");
    await expect(row()).toContainText("Admin");

    await row().getByRole("button", { name: "Remove admin role…" }).click();
    await page.getByRole("dialog", { name: `Make ${name} a member again?` }).getByRole("button", { name: "Remove admin role" }).click();
    await expect(page.getByTestId("members-result")).toHaveText("They're a member again.");

    // S6: remove, after confirming in the dialog. The dialog stacks its content (Impeccable P1).
    await row().getByRole("button", { name: "Remove…" }).click();
    const dialog = page.getByRole("dialog", { name: `Remove ${name} from the group?` });
    await expect(dialog).toBeVisible();
    expect(await dialog.locator("form").evaluate((f) => getComputedStyle(f).display)).toBe("grid");
    const title = await dialog.getByRole("heading").boundingBox();
    const box = await dialog.boundingBox();
    expect(title!.width).toBeGreaterThan(box!.width * 0.6); // the title spans the dialog, not a squeezed column
    await dialog.getByRole("button", { name: `Keep ${name}` }).click();
    await expect(dialog).toBeHidden();
    await row().getByRole("button", { name: "Remove…" }).click();
    await dialog.getByRole("button", { name: `Remove ${name}` }).click();
    await expect(page.getByTestId("members-result")).toContainText("Removed.");
    await expect(page.getByTestId("removed-members")).toContainText(name);

    // They can't sign in again: no new link is sent, and the last one is used up.
    await context.clearCookies();
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await page.goto(await latestLinkFor(page, email));
    await expect(page.getByRole("heading", { name: /expired or was already used/ })).toBeVisible();
  });

  test("the only admin can't remove or demote themselves", async ({ page }) => {
    await signInAs(page, USERS.admin);
    await page.goto("/admin/members");
    const me = page.getByTestId("active-members").getByRole("listitem").filter({ hasText: USERS.admin });
    await expect(me).toContainText("(you)");
    await expect(me.getByRole("button", { name: "Remove…" })).toHaveCount(0);
    await expect(me.getByRole("button", { name: "Remove admin role…" })).toHaveCount(0);
  });

  test("the header marks the current page and offers a skip link", async ({ page }) => {
    await signInAs(page, USERS.admin);
    await page.goto("/items/mine");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Your items" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Browse" })).not.toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  });
});
