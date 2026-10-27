import { expect, test, type Page } from "@playwright/test";

// Requires a locally running stack with a seeded database (`pnpm setup`);
// the signed-in tests log in as the seeded admin. See
// lounge-nav-gamification.pw.ts for the same convention. The decision call
// itself is answered by a route stub so the run needs no provider key; the
// request body it receives is asserted instead.

interface ForwardedRequest {
	model: string;
	input: string;
	questions: { type: string; name: string }[];
}

function stubAnswers(questions: ForwardedRequest["questions"]) {
	return questions.map((question) => {
		switch (question.type) {
			case "predicate":
				return { type: "predicate", name: question.name, probability: 0.92 };
			case "choice":
				return {
					type: "choice",
					name: question.name,
					choice: "billing",
					probabilities: [
						{ value: "billing", probability: 0.8 },
						{ value: "technical", probability: 0.15 },
						{ value: "sales", probability: 0.05 },
					],
					confidence: 0.75,
				};
			default:
				return {
					type: "score",
					name: question.name,
					score: 2.7,
					probabilities: [
						{ value: 0, label: "Low", probability: 0 },
						{ value: 1, label: "Medium", probability: 0.1 },
						{ value: 2, label: "High", probability: 0.1 },
						{ value: 3, label: "Imminent", probability: 0.8 },
					],
					confidence: 0.8,
				};
		}
	});
}

function requiresLocalStack(baseURL: string | undefined) {
	return (
		!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "") &&
		!process.env.PW_TEST_EMAIL
	);
}

async function signIn(page: Page) {
	const email = process.env.PW_TEST_EMAIL ?? "admin@example.com";
	const password = process.env.PW_TEST_PASSWORD ?? email;

	await page.goto("/login");
	await page.fill('input[type="email"]', email);
	await page.fill('input[type="password"]', password);
	await page.click('button[type="submit"]');
	await page.waitForURL(/\/($|\?)/, { timeout: 45_000 });
}

test("signed-out visitors get the SEO landing for the studio", async ({
	page,
}) => {
	await page.goto("/decisions");
	await expect(
		page.getByRole("heading", { level: 1, name: /Decision Studio/ }),
	).toBeVisible();
});

test("a run answers every question with a probability and lands in history", async ({
	page,
	baseURL,
}) => {
	test.skip(
		requiresLocalStack(baseURL),
		"requires a locally seeded stack or PW_TEST_* credentials",
	);
	await signIn(page);

	// Stand in for the gateway: answer every question with a typed value.
	let forwarded: ForwardedRequest | null = null;
	await page.route("**/api/decisions", async (route) => {
		const body = route.request().postDataJSON() as ForwardedRequest;
		forwarded = body;
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				model: "typesafe/jev-1.13.0",
				answers: stubAnswers(body.questions),
				usage: { input_tokens: 321, output_tokens: 0, total_tokens: 321 },
			}),
		});
	});

	await page.goto("/decisions?orgId=test-org-id&model=jev-1.13.0");
	await expect(page.getByText("No decisions yet")).toBeVisible({
		timeout: 30_000,
	});

	// Presets fill the input and the question builder.
	await page.getByRole("button", { name: /Triage a support ticket/ }).click();
	await expect(page.getByLabel("Input to decide on")).toHaveValue(
		/charged twice/,
	);
	await expect(
		page.getByRole("button", { name: /Questions \(3\/10\)/ }),
	).toBeVisible();

	// A blank option disables the run until it is fixed.
	const firstOption = page.getByLabel("Option 1").first();
	await firstOption.fill("");
	await expect(page.getByRole("button", { name: "Decide" })).toBeDisabled();
	await expect(
		page.getByText(/needs at least two named options/),
	).toBeVisible();
	await firstOption.fill("billing");
	await expect(page.getByRole("button", { name: "Decide" })).toBeEnabled();

	await page.getByRole("button", { name: "Decide" }).click();

	// The studio sends the normalized questions with the chosen model.
	await expect.poll(() => forwarded?.model).toBe("jev-1.13.0");
	const sent = forwarded as ForwardedRequest | null;
	expect(sent?.input).toMatch(/charged twice/);
	expect(sent?.questions.map((q) => q.name)).toEqual([
		"department",
		"is_urgent",
		"churn_risk",
	]);

	// One card per question, each with its headline value.
	await expect(page.getByText("321 input tokens")).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.getByText("department", { exact: true })).toBeVisible();
	await expect(page.getByText("is_urgent", { exact: true })).toBeVisible();
	await expect(page.getByText("churn_risk", { exact: true })).toBeVisible();
	await expect(page.getByText("92% yes")).toBeVisible();
	await expect(
		page.getByText("Imminent", { exact: true }).first(),
	).toBeVisible();

	// The run is persisted and shows up in the sidebar history.
	await expect(page).toHaveURL(/[?&]id=/, { timeout: 30_000 });
	await expect(
		page.getByRole("button", { name: /Hi, I was charged twice/ }).first(),
	).toBeVisible();

	// The raw answers are one toggle away.
	await page.getByRole("button", { name: "JSON" }).click();
	await expect(page.locator("pre").first()).toContainText('"answers"');
});
