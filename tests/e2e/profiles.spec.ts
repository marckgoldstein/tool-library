import { expect, test, type Page } from "@playwright/test";
import { signInAs, USERS } from "./helpers";

/** The signed-in member's own profile URL, from the link on /profile. */
async function ownProfileUrl(page: Page) {
  await page.goto("/profile");
  const href = await page.getByRole("link", { name: "See your profile as other members do" }).getAttribute("href");
  if (!href) throw new Error("No profile link");
  return href;
}

test.describe("M2 profiles: contact details and profile page (S4, S5)", () => {
  test("a member saves contact details that other members never see", async ({ page, context }, info) => {
    const phone = info.project.name === "mobile" ? "555-010-0177" : "555-010-0166";
    await signInAs(page, USERS.other);
    await page.getByRole("link", { name: "Your profile" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Your profile" })).toBeVisible();

    await page.getByLabel("Phone number").fill(phone);
    await page.getByLabel("Email for contact").fill("oscar.contact@example.test");
    await page.getByRole("button", { name: "Save contact details" }).click();
    await expect(page.getByTestId("contacts-result")).toContainText("Nobody sees them until you choose to send one.");

    await page.reload();
    await expect(page.getByLabel("Phone number")).toHaveValue(phone);
    await expect(page.getByLabel("Email for contact")).toHaveValue("oscar.contact@example.test");
    const url = await ownProfileUrl(page);

    // Another member sees the profile, without any contact detail or email address.
    await context.clearCookies();
    await signInAs(page, USERS.borrower);
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1, name: "Oscar" })).toBeVisible();
    const body = page.locator("main");
    await expect(body).not.toContainText(phone);
    await expect(body).not.toContainText("oscar.contact@example.test");
    await expect(body).not.toContainText(USERS.other);
  });

  test("the profile page shows name, area, join date and closed-loan counts (S5)", async ({ page, context }) => {
    await signInAs(page, USERS.owner);
    const url = await ownProfileUrl(page);
    await page.goto(url);
    await expect(page.getByText("This is how other members see you.")).toBeVisible();

    await context.clearCookies();
    await signInAs(page, USERS.borrower);
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1, name: "Olivia" })).toBeVisible();
    await expect(page.getByTestId("profile-area")).toHaveText("Maplewood");
    const details = page.getByTestId("profile-details");
    await expect(details).toContainText("Member since");
    // The seed's loans are active or requested, not closed, so they don't count yet.
    await expect(page.getByTestId("lent-count")).toHaveText("0 loans");
    await expect(page.getByTestId("borrowed-count")).toHaveText("0 loans");
    await expect(page.locator("main")).not.toContainText("555-0100"); // Olivia's saved phone stays private
    await expect(page.getByText("This is how other members see you.")).toHaveCount(0);
  });

  test("an unknown member id is a 404", async ({ page }) => {
    await signInAs(page, USERS.borrower);
    const response = await page.goto("/members/not-a-member");
    expect(response?.status()).toBe(404);
  });

  test("a member edits their general area and sees a phone error before saving", async ({ page }, info) => {
    const area = info.project.name === "mobile" ? "Elm Park" : "Oak Hill";
    await signInAs(page, USERS.other);
    await page.goto("/profile");

    const phoneInput = page.getByLabel("Phone number");
    await expect(phoneInput).toHaveAttribute("type", "tel");
    await expect(phoneInput).toHaveAttribute("autocomplete", "tel");
    await phoneInput.fill("12");
    await phoneInput.blur();
    await expect(phoneInput).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Enter a phone number with at least 7 digits")).toBeVisible();

    await page.getByLabel("General area").fill(area);
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByTestId("profile-result")).toHaveText("Profile saved.");
    await page.getByRole("link", { name: "See your profile as other members do" }).click();
    await expect(page.getByTestId("profile-area")).toHaveText(area);
  });
});
