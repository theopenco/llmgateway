import { gatewayClient } from "@/api/gateway";
import { ensureGatewayKey } from "@/api/gateway-key";

jest.mock("@/api/gateway-key", () => ({
	ensureGatewayKey: jest.fn(),
	clearGatewayKey: jest.fn(),
}));

afterEach(() => jest.restoreAllMocks());

test.each(["gpt-image-2", "openai/gpt-image-2"])(
	"image requests preserve the provider selection: %s",
	async (model) => {
		jest.mocked(ensureGatewayKey).mockResolvedValue("test-token");
		const fetch = jest.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ data: [] }), {
				headers: { "Content-Type": "application/json" },
			}),
		);
		const gateway = await gatewayClient("project", model);
		await gateway.POST("/v1/images/generations", {
			body: { model, prompt: "A garden" },
		});
		const request = fetch.mock.calls[0][0] as Request;
		expect(request.headers.get("x-no-fallback")).toBe(
			model.includes("/") ? "true" : null,
		);
		expect(request.headers.get("Authorization")).toBe("Bearer test-token");
	},
);
