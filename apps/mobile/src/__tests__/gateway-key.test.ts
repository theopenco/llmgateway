import { client } from "@/api/client";
import { clearGatewayKey, ensureGatewayKey } from "@/api/gateway-key";

jest.mock("@/api/client", () => ({ client: { POST: jest.fn() } }));

const post = jest.mocked(client.POST);
const response = (token: string) => ({
	data: { ok: true, token, expiresIn: 3600 },
	response: new Response(),
});

beforeEach(() => {
	jest.resetAllMocks();
	clearGatewayKey();
});

test("revalidates a key rotated by another device", async () => {
	post.mockResolvedValueOnce(response("fixture-original"));
	expect(await ensureGatewayKey("project")).toBe("fixture-original");
	post.mockResolvedValueOnce(response("fixture-rotated"));
	expect(await ensureGatewayKey("project")).toBe("fixture-rotated");
	expect(post).toHaveBeenLastCalledWith("/playground/ensure-key", {
		body: { projectId: "project" },
		headers: { Cookie: "llmgateway_playground_key=fixture-original" },
	});
});

test("shares concurrent requests for the same project", async () => {
	post.mockResolvedValue(response("fixture-key"));
	expect(
		await Promise.all([
			ensureGatewayKey("project"),
			ensureGatewayKey("project"),
		]),
	).toEqual(["fixture-key", "fixture-key"]);
	expect(post).toHaveBeenCalledTimes(1);
});

test("rejects a credential returned after sign-out", async () => {
	post.mockResolvedValue(response("fixture-key"));
	const request = ensureGatewayKey("project");
	clearGatewayKey();
	await expect(request).rejects.toThrow("Your session changed");
	await ensureGatewayKey("project");
	expect(post).toHaveBeenLastCalledWith("/playground/ensure-key", {
		body: { projectId: "project" },
		headers: undefined,
	});
});
