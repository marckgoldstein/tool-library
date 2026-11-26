import { expect, test } from "@playwright/test";
import { signInAs, testPhoto, USERS } from "./helpers";

test.describe("M3 listings and search (S7, S8, S9)", () => {
  test("an owner lists an item, another member finds it, and the owner pauses, edits and delists it", async ({ page, context }, info) => {
    const title = `Orbital sander ${info.project.name}-${Date.now()}`;

    // S7: list an item with a photo; the exclusion list is shown before saving.
    await signInAs(page, USERS.owner);
    await page.goto("/items/new");
    await expect(page.getByRole("heading", { name: "Items that can't be listed" })).toBeVisible();
    await expect(page.getByText(/Weapons, vehicles, hazardous materials, medical devices and consumables/)).toBeVisible();
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Category").selectOption({ label: "Sanders and grinders" });
    await page.getByLabel("Description").fill("5-inch random orbit sander with a pack of 120-grit discs.");
    await page.getByLabel("Good", { exact: true }).check();
    await page.getByLabel("Handoff notes").fill("Weekend mornings");
    await page.getByLabel("Photos").setInputFiles(await testPhoto());
    await page.getByRole("button", { name: "List this item" }).click();
    await expect(page.getByTestId("item-result")).toHaveText("Listed. Members in your group can find it now.");
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByTestId("item-status")).toHaveText("Available");
    await expect(page.getByRole("img", { name: `${title}, photo 1 of 1` })).toBeVisible();
    const itemUrl = page.url().split("?")[0]!;

    // S9: another member finds it by keyword and by category, with the owner's general area.
    await context.clearCookies();
    await signInAs(page, USERS.borrower);
    await page.getByRole("link", { name: "Browse", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search", exact: true }).fill(title);
    await page.getByRole("button", { name: "Search" }).click();
    const card = page.getByTestId("results").getByRole("listitem").filter({ hasText: title });
    // Whose it is, not just where (the initials avatar is aria-hidden, so check the label text).
    await expect(card.getByTestId("card-owner").locator("span:not(.avatar)")).toHaveText("Olivia · Maplewood");
    await page.goto(`/items?category=&q=${encodeURIComponent("random orbit")}`);
    await expect(page.getByTestId("results")).toContainText(title); // description match
    await page.goto(`/items?q=${encodeURIComponent("no such thing anywhere")}`);
    await expect(page.getByRole("link", { name: "Clear search" })).toBeVisible();
    await page.goto(itemUrl);
    await expect(page.getByRole("button", { name: "Ask Olivia about it" })).toBeVisible();
    await expect(page.getByText("Lending risk:")).toBeVisible(); // PRD section 10: shown on the item page

    // S8: the owner pauses it; it drops out of search.
    await context.clearCookies();
    await signInAs(page, USERS.owner);
    await page.goto(itemUrl);
    await page.getByRole("button", { name: "Pause listing" }).click();
    await expect(page.getByTestId("item-status")).toHaveText("Paused");
    await context.clearCookies();
    await signInAs(page, USERS.borrower);
    await page.goto(`/items?q=${encodeURIComponent(title)}`);
    await expect(page.getByTestId("results")).not.toContainText(title);
    const paused = await page.goto(itemUrl);
    expect(paused?.status()).toBe(404);

    // Resume, edit, then delist through the confirm dialog.
    await context.clearCookies();
    await signInAs(page, USERS.owner);
    await page.goto(itemUrl);
    await page.getByRole("button", { name: "Resume listing" }).click();
    await expect(page.getByTestId("item-status")).toHaveText("Available");
    await page.getByRole("link", { name: "Edit item" }).click();
    await page.getByLabel("Title").fill(`${title} (with dust bag)`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByTestId("item-result")).toHaveText("Changes saved.");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${title} (with dust bag)`);

    await page.getByRole("button", { name: "Delist…" }).click();
    const dialog = page.getByRole("dialog", { name: /Delist/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Keep it listed" })).toBeFocused();
    await dialog.getByRole("button", { name: "Delist item" }).click();
    await expect(page.getByTestId("mine-result")).toContainText("Delisted.");
    await expect(page.getByTestId("my-items").or(page.getByText("You haven't listed anything yet."))).not.toContainText(title);
  });

  test("a listing with an active loan can't be edited, paused or delisted (D23)", async ({ page }) => {
    await signInAs(page, USERS.owner);
    await page.goto("/items/mine");
    await page.getByRole("link", { name: "Wet tile saw" }).click(); // seeded with an active loan
    await expect(page.getByTestId("item-status")).toHaveText("On loan");
    await expect(page.getByTestId("locked-notice")).toContainText(/With Ben · (due back|overdue since)/); // who has it, and until when
    await expect(page.getByTestId("locked-notice").getByRole("link", { name: "See the loan" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pause listing" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit item" })).toHaveCount(0);
  });

  test("search marks items on loan and the form needs a photo", async ({ page }) => {
    await signInAs(page, USERS.other);
    await page.goto(`/items?q=${encodeURIComponent("tile saw")}`);
    const saw = page.getByTestId("results").getByRole("listitem").filter({ hasText: "Wet tile saw" });
    await expect(saw).toContainText("On loan"); // unavailable: marked, not hidden

    await page.goto("/items/new");
    const photos = page.getByLabel("Photos");
    await expect(photos).toHaveAttribute("required", "");
    await expect(photos).toHaveAttribute("accept", /image\/jpeg/);
  });
});
