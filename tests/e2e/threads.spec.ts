import { expect, test } from "@playwright/test";
import { signInAs, USERS } from "./helpers";

const NOTE = "Only contact this person if you are ready to give them your contact details.";

test.describe("M4 threads and contact sharing (S10, S11)", () => {
  test("a member asks the owner with canned messages and the owner replies", async ({ page, context }) => {
    // Ben asks Oscar about the tent (S10): threads start before any request.
    await signInAs(page, USERS.borrower);
    await page.goto("/items?q=tent");
    await page.getByTestId("results").getByRole("link", { name: /4-person tent/ }).click();
    await page.getByRole("button", { name: "Ask the owner" }).click();
    await expect(page).toHaveURL(/\/threads\//);
    await expect(page.getByRole("heading", { level: 3, name: "Ask about the item" })).toBeVisible();
    // Only the asker's options before a loan: no answers, no return messages, no free text.
    await expect(page.getByRole("heading", { level: 3, name: "Answer about the item" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 3, name: "Return" })).toHaveCount(0);
    await expect(page.locator("main textarea, main input[type='text']")).toHaveCount(0);
    await page.getByRole("button", { name: "What condition is it in?" }).click();
    await expect(page.getByTestId("thread-result")).toHaveText("Sent.");
    await expect(page.getByTestId("thread-messages").getByRole("listitem").last()).toContainText("What condition is it in?");

    // Oscar is emailed the words and a link, and replies from Messages.
    await page.goto("/dev/mailbox");
    await expect(page.getByTestId("mail-item").filter({ hasText: `To: ${USERS.other}` }).first()).toContainText("New message about 4-person tent");
    await context.clearCookies();
    await signInAs(page, USERS.other);
    await page.getByRole("link", { name: "Messages" }).click();
    const row = page.getByTestId("threads").getByRole("listitem").filter({ hasText: "4-person tent" });
    await expect(row).toContainText("asked by Ben");
    await row.getByRole("link", { name: "4-person tent" }).click();
    await expect(page.getByRole("heading", { level: 3, name: "Answer about the item" })).toBeVisible();
    await page.getByRole("button", { name: "It comes with everything shown in the photos." }).click();
    await expect(page.getByTestId("thread-messages").getByRole("listitem").last()).toContainText("It comes with everything shown in the photos.");
  });

  test("the owner sends a phone number after confirming; only the recipient sees the note", async ({ page, context }) => {
    // Olivia has a saved phone (seed) and a thread with Ben about the pressure washer.
    await signInAs(page, USERS.owner);
    await page.goto("/threads");
    await page.getByTestId("threads").getByRole("link", { name: "Pressure washer" }).click();
    await page.getByRole("button", { name: "Send my phone number" }).click();
    const dialog = page.getByRole("dialog", { name: /Send your phone number to Ben/ });
    await expect(dialog).toContainText("Here's my contact info: 555-0100");
    await dialog.getByRole("button", { name: "Send my phone number" }).click();
    await expect(page.getByTestId("thread-result")).toHaveText("Contact details sent. Only this member can see them.");
    const last = page.getByTestId("thread-messages").getByRole("listitem").last();
    await expect(last).toContainText("Here's my contact info: 555-0100");
    await expect(last.getByTestId("recipient-note")).toHaveCount(0); // the sender doesn't see the note

    // Ben sees the value and the recipient-only note; his email has the note but not the number.
    await context.clearCookies();
    await signInAs(page, USERS.borrower);
    await page.goto("/dev/mailbox");
    const mail = page.getByTestId("mail-item").filter({ hasText: "sent you their contact details" }).filter({ hasText: `To: ${USERS.borrower}` }).first();
    await expect(mail).toContainText(NOTE);
    await expect(mail).not.toContainText("555-0100");
    await page.goto("/threads");
    await page.getByTestId("threads").getByRole("link", { name: "Pressure washer" }).click();
    const received = page.getByTestId("thread-messages").getByRole("listitem").last();
    await expect(received).toContainText("Here's my contact info: 555-0100");
    await expect(received.getByTestId("recipient-note")).toHaveText(NOTE);
  });

  test("someone outside the thread gets a 404", async ({ page, context }) => {
    await signInAs(page, USERS.borrower);
    await page.goto("/threads");
    const href = await page.getByTestId("threads").getByRole("link", { name: "Pressure washer" }).getAttribute("href");
    await context.clearCookies();
    await signInAs(page, USERS.other);
    const response = await page.goto(href!);
    expect(response?.status()).toBe(404);
  });
});
