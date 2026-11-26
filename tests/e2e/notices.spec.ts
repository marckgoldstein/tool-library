import { expect, test } from "@playwright/test";

test("required notices are linked from every page footer (PRD section 10)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Built with help from AI tools, including Anthropic's Claude.")).toBeVisible();
  await page.getByRole("link", { name: "Notices and how we use your data" }).click();
  for (const heading of ["Lending risk", "Web service risk", "Meeting in person", "Built with AI tools"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});
