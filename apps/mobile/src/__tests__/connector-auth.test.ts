import { client } from "@/api/client";
import { authorizeConnector, connectorCallbackQuery } from "@/api/connectors";
import NativeLoungeAuth from "@/native/NativeLoungeAuth";

jest.mock("@/api/client", () => ({ client: { POST: jest.fn() } }));
jest.mock("@/native/NativeLoungeAuth", () => ({
	open: jest.fn(),
	cancel: jest.fn(),
}));

const state = "fixture-native-authorization-state-123456";
const consent = `https://oauth.example.com/authorize?state=${state}`;
const callback = `io.llmgateway.lounge://connector/gmail?state=${state}&code=fixture%2Bcode`;

beforeEach(() => {
	jest.resetAllMocks();
	jest
		.mocked(client.POST)
		.mockResolvedValueOnce({ data: { url: consent }, response: new Response() })
		.mockResolvedValue({
			data: { status: "connected" },
			response: new Response(),
		});
	jest.mocked(NativeLoungeAuth.open).mockResolvedValue(callback);
});

test("opens consent and returns the original signed query to authenticated completion", async () => {
	const controller = new AbortController();
	expect(await authorizeConnector("gmail", undefined, controller.signal)).toBe(
		"connected",
	);
	expect(NativeLoungeAuth.open).toHaveBeenCalledWith(consent);
	expect(client.POST).toHaveBeenNthCalledWith(
		1,
		"/connectors/{connectorId}/authorize",
		{
			params: { path: { connectorId: "gmail" } },
			body: { platform: "ios" },
			signal: controller.signal,
		},
	);
	expect(client.POST).toHaveBeenNthCalledWith(
		2,
		"/connectors/{connectorId}/complete",
		{
			params: { path: { connectorId: "gmail" } },
			body: { callbackQuery: `?state=${state}&code=fixture%2Bcode` },
			signal: controller.signal,
		},
	);
	controller.abort();
	expect(NativeLoungeAuth.cancel).not.toHaveBeenCalled();
});

test.each([
	callback.replace("gmail?", "github?"),
	callback.replace("io.llmgateway.lounge:", "https:"),
	callback.replace("//connector/", "//other/"),
	callback.replace(state, "another-state"),
	`${callback}&state=${state}`,
	`${callback}#unexpected`,
	callback.replace("//connector/", "//user@connector/"),
	callback.replace("//connector/", "//connector:123/"),
])("rejects mismatched browser callbacks before linking: %s", async (url) => {
	jest.mocked(NativeLoungeAuth.open).mockResolvedValue(url);
	await expect(
		authorizeConnector("gmail", undefined, new AbortController().signal),
	).rejects.toThrow("did not match");
	expect(client.POST).toHaveBeenCalledTimes(1);
});

test("preserves provider query encodings", () => {
	const query = `?state=${state}&code=a%2Bb&host=fixture%2F%3D%3D&hmac=signature`;
	expect(
		connectorCallbackQuery(
			`io.llmgateway.lounge://connector/shopify${query}`,
			"shopify",
			state,
		),
	).toBe(query);
});

test("consumes cancelled browser authorization without replacing an existing connection", async () => {
	jest
		.mocked(NativeLoungeAuth.open)
		.mockRejectedValue(
			Object.assign(new Error("Cancelled"), { code: "AUTH_CANCELLED" }),
		);
	jest.mocked(client.POST).mockResolvedValue({
		data: { status: "cancelled" },
		response: new Response(),
	});
	expect(
		await authorizeConnector("gmail", undefined, new AbortController().signal),
	).toBe("cancelled");
	expect(client.POST).toHaveBeenLastCalledWith(
		"/connectors/{connectorId}/complete",
		expect.objectContaining({
			body: { callbackQuery: `state=${state}&error=access_denied` },
		}),
	);
});

test("reports a failed token exchange so the user can retry", async () => {
	jest.mocked(client.POST).mockResolvedValue({
		data: { status: "failed" },
		response: new Response(),
	});
	await expect(
		authorizeConnector("gmail", undefined, new AbortController().signal),
	).rejects.toThrow("Try signing in again");
});

test("closes the browser on abort and discards a late callback", async () => {
	const controller = new AbortController();
	jest.mocked(NativeLoungeAuth.open).mockImplementation(async () => {
		controller.abort();
		return callback;
	});
	await expect(
		authorizeConnector("gmail", undefined, controller.signal),
	).rejects.toThrow();
	expect(NativeLoungeAuth.cancel).toHaveBeenCalledTimes(1);
	expect(client.POST).toHaveBeenCalledTimes(1);
});

test("does not open a browser when the request is already aborted", async () => {
	const controller = new AbortController();
	controller.abort();
	await expect(
		authorizeConnector("gmail", undefined, controller.signal),
	).rejects.toThrow();
	expect(NativeLoungeAuth.open).not.toHaveBeenCalled();
});

test("includes a normalized store domain when authorizing Shopify", async () => {
	jest
		.mocked(NativeLoungeAuth.open)
		.mockResolvedValue(callback.replace("gmail?", "shopify?"));
	await authorizeConnector(
		"shopify",
		" fixture.myshopify.com ",
		new AbortController().signal,
	);
	expect(client.POST).toHaveBeenNthCalledWith(
		1,
		"/connectors/{connectorId}/authorize",
		expect.objectContaining({
			body: { platform: "ios", shop: "fixture.myshopify.com" },
		}),
	);
});
