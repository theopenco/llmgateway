import { client, queryClient } from "@/api/client";
import { ensureGatewayKey } from "@/api/gateway-key";
import { rememberProjectExchange } from "@/api/project-memory";

jest.mock("@/api/client", () => ({
	client: { POST: jest.fn() },
	queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("@/api/gateway-key", () => ({ ensureGatewayKey: jest.fn() }));

const exchange = {
	knowledgeProjectId: "knowledge",
	billingProjectId: "billing",
	userMessage: "I prefer concise answers.",
	reply: {
		model: "model",
		content: "I will keep it brief.",
		reasoning: "",
		sources: [],
	},
};
beforeEach(() => {
	jest.clearAllMocks();
	jest.mocked(ensureGatewayKey).mockResolvedValue("test-token");
	jest
		.mocked(client.POST)
		.mockResolvedValue({ data: { memories: [] }, response: new Response() });
});

test("learns from the saved exchange using its billing project and refreshes memory", async () => {
	await rememberProjectExchange(exchange);
	expect(ensureGatewayKey).toHaveBeenCalledWith("billing");
	expect(client.POST).toHaveBeenCalledWith(
		"/chat-projects/{id}/memories/extract",
		expect.objectContaining({
			params: { path: { id: "knowledge" } },
			body: {
				userMessage: exchange.userMessage,
				assistantMessage: exchange.reply.content,
			},
			headers: { "x-llmgateway-key": "test-token" },
		}),
	);
	expect(queryClient.invalidateQueries).toHaveBeenCalled();
});

test.each([
	{ temporary: true },
	{ aborted: true },
	{ knowledgeProjectId: undefined },
	{ userMessage: " " },
	{ reply: { ...exchange.reply, error: new Error("Incomplete response") } },
	{ reply: { ...exchange.reply, content: " " } },
])(
	"does not learn from private, interrupted, or empty exchanges: %j",
	async (overrides) => {
		await rememberProjectExchange({ ...exchange, ...overrides });
		expect(client.POST).not.toHaveBeenCalled();
		expect(ensureGatewayKey).not.toHaveBeenCalled();
	},
);

test("bounds extraction input and reports failures without invalidating saved memories", async () => {
	const warning = jest
		.spyOn(console, "warn")
		.mockImplementation(() => undefined);
	const failure = new Error("Memory service unavailable");
	jest.mocked(client.POST).mockRejectedValueOnce(failure);
	await rememberProjectExchange({
		...exchange,
		userMessage: "a".repeat(9000),
		reply: { ...exchange.reply, content: "b".repeat(9000) },
	});
	expect(client.POST).toHaveBeenCalledWith(
		expect.any(String),
		expect.objectContaining({
			body: {
				userMessage: "a".repeat(8000),
				assistantMessage: "b".repeat(8000),
			},
		}),
	);
	expect(warning).toHaveBeenCalledWith(
		"Could not update project memory",
		failure,
	);
	expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
	warning.mockRestore();
});
