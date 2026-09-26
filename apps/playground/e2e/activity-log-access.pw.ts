import { expect, test } from "@playwright/test";

const apiUrl = process.env.PW_API_URL ?? "http://localhost:4002";

test("Chat plan logs are disabled while organization logs remain linked", async ({
	page,
}) => {
	const login = await page.request.post(`${apiUrl}/auth/sign-in/email`, {
		data: { email: "admin@example.com", password: "admin@example.com" },
	});
	expect(login.ok()).toBe(true);
	const status = await page.request.get(`${apiUrl}/playground/chat-org`);
	const { organizationId: chatOrgId } = (await status.json()) as {
		organizationId: string;
	};
	expect(chatOrgId).toBeTruthy();
	for (const organizationId of [chatOrgId, "test-org-id"]) {
		const response = await page.request.post(`${apiUrl}/chats`, {
			data: {
				title: "Activity log access check",
				model: "gpt-oss-20b",
				organizationId,
			},
		});
		expect(response.status()).toBe(201);
		const { chat } = (await response.json()) as { chat: { id: string } };
		try {
			const message = await page.request.post(
				`${apiUrl}/chats/${chat.id}/messages`,
				{
					data: {
						role: "assistant",
						content: "Local response for log access verification.",
						metadata: {
							usedModel: "gpt-oss-20b",
							organizationId,
							projectId: "test-project-id",
							logId: "local-log-check",
							usage: { inputTokens: 10, outputTokens: 5 },
						},
					},
				},
			);
			expect(message.status()).toBe(201);
			await page.goto(
				`/?id=${chat.id}${organizationId === chatOrgId ? "" : `&orgId=${organizationId}`}`,
			);
			await page
				.getByRole("button", { name: "Show response metadata" })
				.click();
			if (organizationId === chatOrgId) {
				const disabled = page.getByRole("button", {
					name: "Activity log unavailable",
				});
				await expect(disabled).toBeDisabled();
				await disabled.locator("..").hover();
				await expect(page.getByRole("tooltip")).toContainText(
					"Switch to a pay-as-you-go organization",
				);
				await expect(
					page.getByRole("link", { name: "View activity log" }),
				).toHaveCount(0);
			} else {
				await expect(
					page.getByRole("link", { name: "View activity log" }),
				).toHaveAttribute(
					"href",
					/\/dashboard\/test-org-id\/test-project-id\/activity\/local-log-check$/,
				);
			}
		} finally {
			await page.request.delete(`${apiUrl}/chats/${chat.id}`);
		}
	}
});
