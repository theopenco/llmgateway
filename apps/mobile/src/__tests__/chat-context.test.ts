import { chatContext } from "@/api/chat-context";
import { client } from "@/api/client";
import { ensureGatewayKey } from "@/api/gateway-key";

jest.mock("@/api/client", () => ({
	client: { GET: jest.fn(), POST: jest.fn() },
}));
jest.mock("@/api/gateway-key", () => ({ ensureGatewayKey: jest.fn() }));

beforeEach(() => jest.resetAllMocks());

test("applies only enabled skills to the conversation", async () => {
	jest.mocked(client.GET).mockResolvedValue({
		data: {
			skills: [
				{
					id: "on",
					name: "Writing",
					description: "",
					instructions: "Use short sentences.",
					enabled: true,
					createdAt: "",
					updatedAt: "",
				},
				{
					id: "off",
					name: "Pirate",
					description: "",
					instructions: "Speak like a pirate.",
					enabled: false,
					createdAt: "",
					updatedAt: "",
				},
			],
		},
		response: new Response(),
	});
	expect(await chatContext("Hello", "billing")).toBe(
		"Skill: Writing\nUse short sentences.",
	);
	expect(client.POST).not.toHaveBeenCalled();
});

test("loads project knowledge with the selected billing key", async () => {
	jest
		.mocked(client.GET)
		.mockResolvedValue({ data: { skills: [] }, response: new Response() });
	jest.mocked(ensureGatewayKey).mockResolvedValue("fixture-key");
	jest.mocked(client.POST).mockResolvedValue({
		data: {
			project: {
				id: "knowledge",
				name: "Writing",
				instructions: "Be precise.",
			},
			memories: ["Prefer metric units."],
			chunks: [
				{
					content: "A useful excerpt.",
					fileName: "notes.txt",
					fileId: "file",
					score: 1,
				},
			],
		},
		response: new Response(),
	});
	const context = await chatContext(
		"What did I write?",
		"billing",
		"knowledge",
	);
	expect(context).toContain("Prefer metric units.");
	expect(context).toContain("[Source: notes.txt]\nA useful excerpt.");
	expect(client.POST).toHaveBeenCalledWith("/chat-projects/{id}/retrieve", {
		params: { path: { id: "knowledge" } },
		body: { query: "What did I write?" },
		headers: { "x-llmgateway-key": "fixture-key" },
	});
});

test("surfaces unavailable knowledge instead of silently omitting it", async () => {
	jest
		.mocked(client.GET)
		.mockResolvedValue({ data: { skills: [] }, response: new Response() });
	jest
		.mocked(client.POST)
		.mockRejectedValue(new Error("Knowledge unavailable"));
	await expect(chatContext("Hello", "billing", "knowledge")).rejects.toThrow(
		"Knowledge unavailable",
	);
});
