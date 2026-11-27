import { expect, test, type Page } from "@playwright/test";
import { signInAs, USERS } from "./helpers";

/** A datetime-local value N days from now at a fixed hour (the browser runs in America/New_York). */
function localDays(days: number, hour: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
}

async function openWasherLoanAsBen(page: Page, offsetDays: number) {
  await page.goto("/items?q=pressure");
  await page.getByTestId("results").getByRole("link", { name: /Pressure washer/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pressure washer" })).toBeVisible(); // page loaded before checking
  const existing = page.getByTestId("my-request");
  if (await existing.isVisible()) {
    // The seed gives Ben an open request for the washer; reuse it on the first run.
    await existing.getByRole("link", { name: "See where it stands" }).click();
    return;
  }
  await page.getByLabel("From").fill(localDays(offsetDays, 10));
  await page.getByLabel("Until").fill(localDays(offsetDays + 1, 18));
  await page.getByRole("button", { name: "Send request to Olivia" }).click();
  await expect(page.getByTestId("loan-result")).toContainText("Request sent.");
}

test.describe("M5 loan loop (S12–S20)", () => {
  test("request, approve, pickup gate, pickup, return and the owner's confirmation", async ({ page, context }, info) => {
    // S12: Ben requests the washer (or opens his existing request).
    await signInAs(page, USERS.borrower);
    await openWasherLoanAsBen(page, info.project.name === "mobile" ? 20 : 12);
    await expect(page.getByTestId("loan-status")).toHaveText("Requested");
    await expect(page.getByRole("button", { name: "Withdraw request…" })).toBeVisible(); // S13 is offered
    const loanUrl = page.url().split("?")[0]!;

    // S14: Olivia sees it waiting on her and approves.
    await context.clearCookies();
    await signInAs(page, USERS.owner);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Loans/ }).locator(".count")).toBeVisible(); // header badge
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Loans/ }).click();
    await expect(page.getByTestId("loans-todo")).toContainText("Approve or decline");
    await page.goto(loanUrl);
    await page.getByRole("button", { name: "Approve request" }).click();
    await expect(page.getByTestId("loan-result")).toContainText("Approved.");
    await expect(page.getByTestId("loan-status")).toHaveText("Approved");
    await expect(page.getByText("Meeting in person:")).toBeVisible(); // PRD section 10: shown at the pickup step

    // S15: pickup waits for a shared contact detail; Olivia sends hers from the thread.
    const gate = page.getByTestId("pickup-gate");
    if (await gate.isVisible()) {
      await expect(page.getByRole("button", { name: "Mark picked up" })).toBeDisabled();
      await gate.getByRole("link", { name: "Open the thread" }).click();
      await page.getByRole("button", { name: "Send my phone number" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Send my phone number" }).click();
      await expect(page.getByTestId("thread-result")).toContainText("Contact details sent.");
      await page.getByRole("link", { name: "See the loan" }).click();
    }

    // S16: the owner marks pickup.
    await page.getByRole("button", { name: "Mark picked up" }).click();
    await expect(page.getByTestId("loan-status")).toHaveText(/Picked up|Overdue/);

    // S19: Ben marks it returned.
    await context.clearCookies();
    await signInAs(page, USERS.borrower);
    await page.goto(loanUrl);
    await page.getByRole("button", { name: "Mark returned…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Yes, mark returned" }).click();
    await expect(page.getByTestId("loan-status")).toHaveText("Returned, waiting for the owner");

    // S20: Olivia confirms it came back fine; the loan closes.
    await context.clearCookies();
    await signInAs(page, USERS.owner);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Loans/ }).click();
    await expect(page.getByTestId("loans-todo")).toContainText("Check it over and confirm");
    await page.goto(loanUrl);
    await page.getByRole("button", { name: "Confirm the return…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Came back fine")).toBeChecked();
    await dialog.getByRole("button", { name: "Close the loan" }).click();
    await expect(page.getByTestId("loan-status")).toHaveText("Closed");
    await expect(page.getByTestId("loan-outcome")).toHaveText("Came back fine");
    await expect(page.getByRole("listitem").filter({ hasText: "Closed" }).first()).toBeVisible(); // history
  });

  test("a borrower withdraws a request, and an owner declines with a reason", async ({ page, context }, info) => {
    const base = info.project.name === "mobile" ? 40 : 30;
    // Ben requests the tent twice (two separate date ranges), withdraws one, Oscar declines the other.
    await signInAs(page, USERS.borrower);
    const urls: string[] = [];
    for (const offset of [base, base + 3]) {
      await page.goto("/items?q=tent");
      await page.getByTestId("results").getByRole("link", { name: /4-person tent/ }).click();
      await expect(page.getByRole("heading", { level: 1, name: "4-person tent" })).toBeVisible();
      const existing = page.getByTestId("my-request");
      if (await existing.isVisible()) {
        await existing.getByRole("link", { name: "See where it stands" }).click();
        await page.getByRole("button", { name: "Withdraw request…" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Withdraw request" }).click();
        await page.goto("/items?q=tent");
        await page.getByTestId("results").getByRole("link", { name: /4-person tent/ }).click();
        await expect(page.getByRole("heading", { level: 1, name: "4-person tent" })).toBeVisible();
      }
      await page.getByLabel("From").fill(localDays(offset, 9));
      await page.getByLabel("Until").fill(localDays(offset + 1, 9));
      await page.getByRole("button", { name: "Send request to Oscar" }).click();
      await expect(page.getByTestId("loan-status")).toHaveText("Requested");
      urls.push(page.url().split("?")[0]!);
      if (urls.length === 1) {
        // S13: withdraw the first.
        await page.getByRole("button", { name: "Withdraw request…" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Withdraw request" }).click();
        await expect(page.getByTestId("loan-status")).toHaveText("Cancelled");
      }
    }

    // S14: Oscar declines the second with a canned reason.
    await context.clearCookies();
    await signInAs(page, USERS.other);
    await page.goto(urls[1]!);
    await page.getByRole("button", { name: "Decline…" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason").selectOption({ label: "Dates don't work." });
    await dialog.getByRole("button", { name: "Decline request" }).click();
    await expect(page.getByTestId("loan-status")).toHaveText("Declined");
    await expect(page.getByRole("listitem").filter({ hasText: "Dates don't work." })).toBeVisible();
  });

  test("someone outside a loan gets a 404", async ({ page }) => {
    await signInAs(page, USERS.other);
    const response = await page.goto(`/loans/${process.env.E2E_OVERDUE_LOAN_ID}`);
    expect(response?.status()).toBe(404);
  });
});
