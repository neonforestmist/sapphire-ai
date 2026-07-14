import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  const externalOrigin = process.env.PLAYWRIGHT_ORIGIN;
  if (!externalOrigin) return;

  await page.route("**/api/**", async (route) => {
    const headers = await route.request().allHeaders();
    await route.continue({ headers: { ...headers, origin: externalOrigin } });
  });
});

test("keeps the landing page focused and overflow-free on small screens", async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /the interviewer that can see how you think/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /set up your interview/i })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /see the product loop/i })).toHaveCount(0);

    const viewport = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.viewportWidth);
  }
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
  const targetRole = page.getByLabel("Target role");
  await expect(targetRole).toHaveValue("");
  await expect(targetRole).toHaveAttribute("placeholder", /nurse, teacher, product manager/i);
  await expect(page.getByRole("heading", { name: "What each format means" })).toBeVisible();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(5);
  await expect(page.getByText("Every career", { exact: true })).toBeVisible();
  await expect(page.getByText(/conversation-only back-and-forth/i)).toBeVisible();
  await expect(page.getByText("Design one shared usage limit for an AI study helper.")).toHaveCount(0);
  const formatBox = await page.getByLabel("Interview format").boundingBox();
  const experienceBox = await page.getByLabel("Experience level").boundingBox();
  const guideBox = await page.getByRole("heading", { name: "What each format means" }).boundingBox();
  const roleBox = await page.getByLabel("Target role").boundingBox();
  expect(formatBox).not.toBeNull();
  expect(experienceBox).not.toBeNull();
  expect(guideBox).not.toBeNull();
  expect(roleBox).not.toBeNull();
  expect(Math.abs(formatBox!.y - experienceBox!.y)).toBeLessThanOrEqual(1);
  expect(guideBox!.y + guideBox!.height).toBeLessThan(roleBox!.y);
  await targetRole.fill("AI engineering internship");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^start interview$/i }).click();
  await expect(page).toHaveURL(/\/interview\/session-[A-Za-z0-9_-]+$/);
  const sessionId = page.url().split("/").at(-1)!;

  await expect(page.getByText(/AI engineering internship, Intern/i)).toBeVisible();
  const conversation = page.getByLabel("Interview conversation");
  await expect(conversation.getByText(/Hey there! I’ll guide your AI engineering internship practice interview/i)).toBeVisible();
  await expect(conversation.getByText("Give an AI study helper one shared usage limit.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Voice", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Text", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Unmute microphone", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /load example board/i }).click();
  await page.getByLabel("Message Sapphire").fill("Each student gets one shared usage limit across the US and EU.");
  await page.getByRole("button", { name: /send message/i }).click();
  await expect(page.getByLabel("Candidate message").last()).toContainText(/shared usage limit/i);

  const probe = page.getByTestId("interviewer-probe");
  await expect(probe).toContainText("one shared limit");
  await expect(probe).toContainText("regional counters");
  await expect(page.getByText(/Evidence focus: US counter \+ EU counter/i)).toBeVisible();
  await expect(page.getByText(/High-confidence mismatch/i)).toBeVisible();

  await page.getByRole("button", { name: /add coordination path/i }).click();
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
  await page.getByLabel("Target role").fill("Teacher");
  await expect(enterButton).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(enterButton).toBeEnabled();
});

test("keeps a non-technical behavioral interview conversational in text or voice", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    const trackedWindow = window as Window & { __spokenTurns?: string[] };
    trackedWindow.__spokenTurns = [];
    window.speechSynthesis.speak = (utterance) => {
      trackedWindow.__spokenTurns?.push(utterance.text);
    };
  });
  await page.goto("/interview/new");
  await page.getByLabel("Interview format").selectOption("behavioral");
  await page.getByLabel("Target role").fill("Nurse");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^start interview$/i }).click();

  const conversation = page.getByLabel("Interview conversation");
  await expect(conversation.getByText(/Hey there! I’ll guide your Nurse practice interview/i)).toBeVisible();
  await expect(conversation.getByText(/Here’s your first question: Tell me about a time/i)).toBeVisible();
  await expect.poll(() => page.evaluate(
    () => (window as Window & { __spokenTurns?: string[] }).__spokenTurns ?? [],
  )).toContainEqual(expect.stringContaining("Hey there!"));

  const sendButton = page.getByRole("button", { name: /send message/i });
  const interviewCard = sendButton.locator("xpath=ancestor::section[1]");
  const [sendBounds, cardBounds] = await Promise.all([
    sendButton.boundingBox(),
    interviewCard.boundingBox(),
  ]);
  expect(sendBounds).not.toBeNull();
  expect(cardBounds).not.toBeNull();
  expect(sendBounds!.y + sendBounds!.height).toBeLessThanOrEqual(
    cardBounds!.y + cardBounds!.height + 1,
  );

  await page.getByRole("button", { name: "Text", exact: true }).click();
  await expect(page.getByRole("button", { name: "Text", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Unmute microphone", exact: true })).toHaveCount(0);

  await page.getByLabel("Message Sapphire").fill("I learned a new scheduling tool during a busy week and made a short guide for my team.");
  await page.getByRole("button", { name: /send message/i }).click();
  await expect(conversation.getByText(/What did you personally do/i)).toBeVisible();
  await expect.poll(() => page.evaluate(
    () => (window as Window & { __spokenTurns?: string[] }).__spokenTurns?.length ?? 0,
  )).toBe(1);

  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unmute microphone", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(
    () => (window as Window & { __spokenTurns?: string[] }).__spokenTurns ?? [],
  )).toContainEqual(expect.stringContaining("What did you personally do"));
});
