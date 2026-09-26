import { expect, test } from "@playwright/test";

test("registration reuses canonical metadata and lets providers copy a tariff", async ({
	page,
}) => {
	await page.goto("/login");
	await page.locator('input[type="email"]').fill("ops@mistral.ai");
	await page.locator('input[type="password"]').fill("ops@mistral.ai");
	await page.locator('button[type="submit"]').click();
	await page.waitForURL("**/dashboard**");
	await expect(
		page.getByRole("link", { name: "Model rankings" }),
	).toHaveAttribute("href", /\/rankings$/);
	await page.goto("/dashboard/fleet");
	await page.getByTestId("register-model-button").click();
	await expect(page.getByTestId("model-api-format")).toHaveText(
		"Carrier default",
	);
	await page.getByTestId("model-name-input").fill("new-provider-model");
	await page.getByLabel("Display name", { exact: true }).fill("New model");
	await page
		.getByLabel("Description", { exact: true })
		.fill("A new deployment.");
	await expect(
		page.locator('#model-family-suggestions option[value="google"]'),
	).toHaveCount(1);
	await expect(
		page.locator('#model-family-suggestions option[value="openai"]'),
	).toHaveCount(1);
	await page.getByTestId("model-name-input").fill("gpt-oss-20b");
	await expect(page.getByLabel("Display name", { exact: true })).toHaveCount(0);
	await expect(page.getByLabel("Description", { exact: true })).toHaveCount(0);
	await expect(page.getByLabel("Family", { exact: true })).toHaveCount(0);
	await page.getByTestId("cached-input-price").fill("9");
	await page.getByRole("button", { name: "Use catalog price" }).click();
	await expect(page.getByTestId("input-price")).toHaveValue("0.1");
	await expect(page.getByTestId("output-price")).toHaveValue("0.5");
	await expect(page.getByTestId("cached-input-price")).toHaveValue("");
	await expect(page.getByTestId("request-price")).toHaveValue("0");
	await page.getByTestId("model-name-input").fill("new-provider-model");
	await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(
		"New model",
	);
	await expect(
		page.getByRole("button", { name: "Use catalog price" }),
	).toHaveCount(0);
});

test("free calculators handle cached tokens, flat charges and rate ceilings", async ({
	page,
}) => {
	await page.goto("/tools/token-cost-calculator");
	await expect(page.getByTestId("request-cost")).toHaveText("$0.002");
	await expect(page.getByTestId("monthly-cost")).toHaveText("$20.00");
	await page.locator("#cost-cached").fill("600");
	await page.locator("#cost-cachedRate").fill("0.5");
	await page.locator("#cost-requestRate").fill("0.001");
	await expect(page.getByTestId("request-cost")).toHaveText("$0.0027");
	await page.locator("#cost-cached").fill("1001");
	await expect(page.locator("main").getByRole("alert")).toContainText(
		"Cached input cannot exceed",
	);
	await page.locator("#cost-cached").fill("0");
	await page.locator("#cost-inputRate").fill("");
	await expect(page.getByTestId("request-cost")).toHaveCount(0);
	await page.goto("/tools/rate-limit-calculator");
	await expect(page.getByTestId("daily-capacity")).toHaveText("20,000");
	await expect(page.getByTestId("capacity-concurrency")).toHaveText("10");
	await page.locator("#capacity-rpd").fill("");
	await expect(page.getByTestId("daily-capacity")).toHaveText("86,400");
	await page.locator("#capacity-rpm").fill("0");
	await expect(page.getByTestId("daily-capacity")).toHaveText("0");
	await page.locator("#capacity-rpm").fill("1.5");
	await expect(page.locator("main").getByRole("alert")).toContainText(
		"whole numbers",
	);
});

test("provider resources render indexable content and link every guide and tool", async ({
	browser,
	baseURL,
}) => {
	const context = await browser.newContext({
		javaScriptEnabled: false,
		baseURL,
		viewport: { width: 390, height: 844 },
	});
	const page = await context.newPage();
	await page.goto("/resources");
	const links = await page
		.locator('main a[href^="/guides/"], main a[href^="/tools/"]')
		.evaluateAll((elements) =>
			elements.map((element) => element.getAttribute("href")!),
		);
	expect(links).toHaveLength(4);
	for (const path of links) {
		const response = await page.goto(path);
		expect(response?.status()).toBe(200);
		await expect(page.locator("h1")).toHaveCount(1);
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			"href",
			`https://airside.llmgateway.io${path}`,
		);
		const json = await page
			.locator('script[type="application/ld+json"]')
			.textContent();
		expect(JSON.parse(json!).url).toBe(`https://airside.llmgateway.io${path}`);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
	}
	await context.close();
});
