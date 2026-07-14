import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  const externalOrigin = process.env.PLAYWRIGHT_ORIGIN;
  if (!externalOrigin) return;

  await page.route("**/api/**", async (route) => {
    const headers = await route.request().allHeaders();
    await route.continue({ headers: { ...headers, origin: externalOrigin } });
  });
});

test("grounds a rate-limiter contradiction in exact board evidence and records the revision", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /the interviewer that can see how you think/i })).toBeVisible();
  await page.getByRole("link", { name: /set up your interview/i }).click();

  await expect(page.getByLabel("Interview format")).toHaveValue("system-design");
  await expect(page.getByLabel("Experience level")).toHaveValue("intern");
  await expect(page.getByLabel("Target role")).toHaveValue("AI engineering internship");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^start interview$/i }).click();
  await expect(page).toHaveURL(/\/interview\/session-[A-Za-z0-9_-]+$/);
  const sessionId = page.url().split("/").at(-1)!;

  await expect(page.getByText(/AI engineering internship, Intern/i)).toBeVisible();
  await expect(page.getByText("Give an AI study helper one shared usage limit.")).toBeVisible();
  await page.getByRole("button", { name: /load example board/i }).click();
  await page.getByRole("button", { name: /send reasoning/i }).click();
  await expect(page.getByText(/reasoning captured as finalized transcript evidence/i)).toBeVisible();

  await page.getByRole("button", { name: /^analyze board$/i }).click();
  const probe = page.getByTestId("interviewer-probe");
  await expect(probe).toContainText("one shared limit");
  await expect(probe).toContainText("regional counters");
  await expect(page.getByText(/Evidence focus: US counter \+ EU counter/i)).toBeVisible();
  await expect(page.getByText(/High-confidence mismatch/i)).toBeVisible();

  await page.getByRole("button", { name: /add coordination path/i }).click();
  await page.getByRole("button", { name: /send reasoning/i }).click();
  await page.getByRole("button", { name: /^analyze board$/i }).click();
  await expect(page.getByText(/Revision recognized/i)).toBeVisible();
  await expect(page.getByText(/coordination path now connects both regional counters/i)).toBeVisible();

  await page.getByRole("button", { name: /finish & review/i }).click();
  await expect(page).toHaveURL(new RegExp(`/interview/${sessionId}/report$`));
  await expect(page.getByRole("heading", { name: /contradiction → probe → revision/i })).toBeVisible();
  const detectedInconsistency = page.getByRole("button", { name: /Detected inconsistency/i });
  await expect(detectedInconsistency).not.toContainText("Not observed");
  await expect(detectedInconsistency).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/2 exact elements highlighted/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Interviewer probe/i })).not.toContainText("Not observed");
  await expect(page.getByRole("button", { name: /Candidate revision/i })).not.toContainText("Not observed");
  await expect(page.getByText(/exact board elements/i)).toBeVisible();

  await page.getByRole("link", { name: /open full replay/i }).click();
  await expect(page).toHaveURL(new RegExp(`/interview/${sessionId}/replay$`));
  await expect(page.getByRole("heading", { name: /board evolution \+ transcript evidence/i })).toBeVisible();
  await expect(page.getByText(/one shared usage limit/i)).toBeVisible();
  await page.getByRole("button", { name: /candidate revision/i }).click();
  await expect(page.locator('[data-element-id="global-quota-coordinator"]')).toBeVisible();

  await page.getByRole("link", { name: /back to report/i }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /delete session data/i }).click();
  await expect(page).toHaveURL("/");
  await page.goto(`/interview/${sessionId}/report`);
  await expect(page.getByRole("heading", { name: /report unavailable/i })).toBeVisible();
});

test("requires explicit transcript consent before creating an anonymous session", async ({ page }) => {
  await page.goto("/interview/new");
  const enterButton = page.getByRole("button", { name: /^start interview$/i });
  await expect(enterButton).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(enterButton).toBeEnabled();
});
