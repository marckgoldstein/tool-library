import { expect, test } from "@playwright/test";
import { latestLinkFor, signInAs, USERS } from "./helpers";

test.describe("M2 join path: suggest, approve, join (S1, S2, S3, T8)", () => {
  test("a member suggests a friend, the admin approves, and the friend joins and signs in", async ({ page, context }, info) => {
    const stamp = `${info.project.name}-${Date.now()}`;
    const friend = { name: `Sam ${stamp}`, email: `sam-${stamp}@example.test` };

    // S1: a member suggests someone.
    await signInAs(page, USERS.owner);
    await page.getByRole("link", { name: "Suggest someone" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Suggest someone to join" })).toBeVisible();
    await page.getByLabel("Their name").fill(friend.name);
    await page.getByLabel("Their email address").fill(friend.email);
    await page.getByRole("button", { name: "Suggest this person" }).click();
    await expect(page.getByTestId("suggest-result")).toHaveText(`Thanks. The admin will review your suggestion for ${friend.name}.`);
    await expect(page.getByTestId("my-suggestions").getByRole("listitem").filter({ hasText: friend.name })).toContainText("Waiting for the admin");

    // Suggesting the same address again is refused with a clear reason.
    await page.getByLabel("Their name").fill(friend.name);
    await page.getByLabel("Their email address").fill(friend.email);
    await page.getByRole("button", { name: "Suggest this person" }).click();
    await expect(page.getByTestId("suggest-result")).toHaveText(/already suggested that address/);
    await expect(page.getByLabel("Their email address")).toHaveValue(friend.email); // nothing to retype

    // Members can't open the admin page.
    const memberView = await page.goto("/admin/invitations");
    expect(memberView?.status()).toBe(404);

    // S2: the admin is emailed and approves.
    await context.clearCookies();
    await signInAs(page, USERS.admin);
    await page.getByRole("link", { name: /Member suggestions/ }).click();
    const card = page.getByTestId("pending-suggestions").getByRole("listitem").filter({ hasText: friend.name });
    await expect(card).toContainText(friend.email);
    await expect(card).toContainText("Olivia"); // the admin sees who suggested them (D11: admin only)
    await card.getByRole("button", { name: "Approve and send invite" }).click();
    await expect(page.getByTestId("admin-result")).toHaveText("Approved. The invite link is on its way.");
    await expect(page.getByTestId("sent-invites")).toContainText(friend.name);

    // S3: the friend opens the invite link.
    await context.clearCookies();
    const invite = await latestLinkFor(page, friend.email);
    expect(invite).toMatch(/\/join\//);
    await page.goto(invite);
    await expect(page.getByRole("heading", { level: 1, name: "Join Friends & Family Pilot" })).toBeVisible();
    await expect(page.getByLabel("Display name")).toHaveValue(friend.name);
    for (const notice of ["Lending risk", "Web service risk", "Built with AI tools"]) {
      await expect(page.getByRole("heading", { name: notice })).toBeVisible();
    }
    const area = page.getByLabel("General area");
    await expect(area).toHaveAttribute("maxlength", "40");
    await area.fill("Maplewood");

    // T8: joining without accepting the notices is blocked, with the reason shown.
    await page.getByRole("button", { name: "Join and email me a sign-in link" }).click();
    await expect(page).toHaveURL(/\/join\//);
    const accept = page.getByLabel("I've read these notices and accept them");
    await expect(accept).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Tick the box to accept the notices.")).toBeVisible();

    await accept.check();
    await page.getByRole("button", { name: "Join and email me a sign-in link" }).click();
    await expect(page).toHaveURL(/\/sign-in\/check-email\?joined=1/);
    await expect(page.getByText("Welcome to the group.")).toBeVisible();

    // Signs in by email (D27) and lands in the group.
    await page.goto(await latestLinkFor(page, friend.email));
    await expect(page.getByRole("heading", { name: `Welcome back, ${friend.name}` })).toBeVisible();
    await expect(page.getByText("Friends & Family Pilot")).toBeVisible();

    // The invite link worked once.
    await context.clearCookies();
    await page.goto(invite);
    await expect(page.getByRole("heading", { name: "This invite link has expired or was already used" })).toBeVisible();
  });

  test("an unknown invite link explains what to do", async ({ page }) => {
    await page.goto("/join/not-a-real-token");
    await expect(page.getByRole("heading", { name: "This invite link has expired or was already used" })).toBeVisible();
    await expect(page.getByRole("link", { name: "sign in with your email" })).toBeVisible();
  });

  test("the suggest form follows form best practice", async ({ page }) => {
    await signInAs(page, USERS.borrower);
    await page.goto("/invite");
    const email = page.getByLabel("Their email address");
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("required", "");
    await expect(email).toHaveAttribute("aria-invalid", "false"); // no error before interaction
    await email.fill("not-an-email");
    await email.blur();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Enter a valid email address, like name@example.com.")).toBeVisible();
  });
});
