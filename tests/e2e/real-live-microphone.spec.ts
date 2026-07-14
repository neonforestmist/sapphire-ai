import { expect, test } from "@playwright/test";

test.skip(
  process.env.RUN_REAL_LIVE_SMOKE !== "true",
  "Real Gemini Live checks are opt-in and require an explicitly configured free-tier server.",
);

test("starts muted and streams a synthetic microphone only after unmute", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/interview/new");
  await page.getByLabel("Interview format").selectOption("behavioral");
  await page.getByLabel("Target role").fill("Customer support manager");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Start interview", exact: true }).click();

  const unmute = page.getByRole("button", { name: "Unmute microphone", exact: true });
  await expect(unmute).toBeVisible();
  await expect(page.getByText("Microphone starts muted", { exact: true })).toBeVisible();
  await unmute.click();

  await expect(page.getByRole("button", { name: "Mute microphone", exact: true })).toBeVisible();
  await expect(page.getByText("Listening now", { exact: true })).toBeVisible();
});
