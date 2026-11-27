import { expect, test } from "@playwright/test";
import { joinNewMember, signInAs, testPhoto, USERS } from "./helpers";

/** A datetime-local value N days from now at a fixed hour. */
function localDays(days: number, hour: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
}

test.describe("M6 account and admin tools (S21, S23, S24, T14)", () => {
  test("a member deletes their account after confirming", async ({ page, context }, info) => {
    const stamp = `${info.project.name}-${Date.now()}`;
    const email = `dana-${stamp}@example.test`;
    await joinNewMember(page, context, `Dana ${stamp}`, email);

    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Delete your account" })).toBeVisible();
    await page.getByRole("button", { name: "Delete my account…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete your account?" });
    await expect(dialog.getByRole("button", { name: "Keep my account" })).toBeVisible();
    // The confirmation checkbox is required: submitting without it does nothing.
    await dialog.getByRole("button", { name: "Delete my account" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("I understand my account and details will be removed").check();
    await dialog.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Your account is deleted" })).toBeVisible();

    // They're signed out, and their name is gone from the admin's member list.
    expect((await page.goto("/profile"))?.url()).toMatch(/sign-in/);
    await context.clearCookies();
    await signInAs(page, USERS.admin);
    await page.goto("/admin/members");
    await expect(page.getByTestId("active-members")).not.toContainText(email);
  });

  test("a member with a loan in progress is told what to finish first", async ({ page }) => {
    // Seed: Ben has a loan in progress.
    await signInAs(page, USERS.borrower);
    await page.goto("/profile");
    await expect(page.getByTestId("delete-blocked")).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete my account…" })).toHaveCount(0);
  });

  test("the admin takes down a listing with a note; its photo stays private", async ({ page, context }, info) => {
    const stamp = `${info.project.name}-${Date.now()}`;
    const title = `Leaf blower ${stamp}`;
    await signInAs(page, USERS.other);
    await page.goto("/items/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Category").selectOption({ label: "Sanders and grinders" });
    await page.getByLabel("Description").fill("Gas leaf blower.");
    await page.getByLabel("Good", { exact: true }).check();
    await page.getByLabel("Photos").setInputFiles(await testPhoto());
    await page.getByRole("button", { name: "List this item" }).click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    const itemUrl = page.url().split("?")[0]!;
    const photoSrc = await page.getByRole("img", { name: `${title}, photo 1 of 1` }).getAttribute("src");

    // T14: the photo isn't served to someone who isn't signed in.
    await context.clearCookies();
    expect((await page.request.get(photoSrc!)).status()).toBe(404);

    await signInAs(page, USERS.admin);
    await page.goto(itemUrl);
    await page.getByRole("button", { name: "Take down this listing…" }).click();
    const dialog = page.getByRole("dialog", { name: `Take down ${title}?` });
    await dialog.getByLabel(/Note for/).fill("Gas tools aren't allowed in the group.");
    await dialog.getByRole("button", { name: "Take down listing" }).click();
    await expect(page.getByTestId("browse-result")).toContainText("Listing taken down");

    // The owner sees it delisted.
    await context.clearCookies();
    await signInAs(page, USERS.other);
    await page.goto(itemUrl);
    await expect(page.getByTestId("item-status")).toHaveText("Delisted");
  });

  test("the admin closes a removed member's open loan", async ({ page, context }, info) => {
    const stamp = `${info.project.name}-${Date.now()}`;
    const name = `Kai ${stamp}`;
    const email = `kai-${stamp}@example.test`;
    await joinNewMember(page, context, name, email);

    // Kai requests Oscar's tent.
    await page.goto("/items?q=tent");
    await page.getByTestId("results").getByRole("link", { name: /4-person tent/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "4-person tent" })).toBeVisible();
    const offset = info.project.name === "mobile" ? 80 : 70;
    await page.getByLabel("From").fill(localDays(offset, 9));
    await page.getByLabel("Until").fill(localDays(offset + 1, 9));
    await page.getByRole("button", { name: "Send request to Oscar" }).click();
    await expect(page.getByTestId("loan-status")).toHaveText("Requested");

    // The admin removes Kai, then closes the loan from the members page.
    await context.clearCookies();
    await signInAs(page, USERS.admin);
    await page.goto("/admin/members");
    await page.getByTestId("active-members").getByRole("listitem").filter({ hasText: email }).getByRole("button", { name: "Remove…" }).click();
    await page.getByRole("dialog", { name: `Remove ${name} from the group?` }).getByRole("button", { name: `Remove ${name}` }).click();
    await expect(page.getByTestId("members-result")).toContainText("Removed.");
    const openLoans = page.getByTestId("removed-members").getByRole("listitem").filter({ hasText: name }).getByTestId("removed-open-loans");
    await expect(openLoans).toContainText("1 open loan to close");
    await openLoans.getByRole("link", { name: "4-person tent" }).click();

    await page.getByRole("button", { name: "Close this loan…" }).click();
    const dialog = page.getByRole("dialog", { name: "Close this loan for the removed member?" });
    await dialog.getByLabel("Note").fill("Member removed before pickup.");
    await dialog.getByRole("button", { name: "Close the loan" }).click();
    await expect(page.getByTestId("loan-status")).toHaveText("Cancelled");

    await page.goto("/admin/members");
    await expect(page.getByTestId("removed-members").getByRole("listitem").filter({ hasText: name })).not.toContainText("open loan");
  });
});
