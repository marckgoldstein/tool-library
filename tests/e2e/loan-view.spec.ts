import { expect, test } from "@playwright/test";
import { signInAs, USERS } from "./helpers";

const loanId = () => {
  const id = process.env.E2E_OVERDUE_LOAN_ID;
  if (!id) throw new Error("global setup did not seed the overdue loan");
  return id;
};

test.describe("loan page from email links (S18, D30, access rules)", () => {
  test("the borrower sees an overdue loan in their own timezone", async ({ page }) => {
    await signInAs(page, USERS.borrower);
    await page.goto(`/loans/${loanId()}`);
    await expect(page.getByRole("heading", { name: "Wet tile saw" })).toBeVisible();
    await expect(page.getByTestId("loan-status")).toHaveText("Overdue");
    await expect(page.getByText("America/New York")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Picked up" })).toBeVisible();
  });

  test("someone who isn't a party gets a 404", async ({ page }) => {
    await signInAs(page, USERS.other);
    const response = await page.goto(`/loans/${loanId()}`);
    expect(response?.status()).toBe(404);
  });

  test("an admin can view it", async ({ page }) => {
    await signInAs(page, USERS.admin);
    await page.goto(`/loans/${loanId()}`);
    await expect(page.getByText("Admin view")).toBeVisible();
  });

  test("signed-out visitors are sent to sign in", async ({ page }) => {
    await page.goto(`/loans/${loanId()}`);
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
