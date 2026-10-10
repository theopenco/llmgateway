import { ApiError, assertResponseOk, errorMessage } from "@/api/errors";

test("reads API and gateway error envelopes", () => {
	expect(errorMessage({ message: "Session expired" }, "Fallback")).toBe(
		"Session expired",
	);
	expect(
		errorMessage({ error: { message: "Insufficient credits" } }, "Fallback"),
	).toBe("Insufficient credits");
	expect(errorMessage({ error: "Model unavailable" }, "Fallback")).toBe(
		"Model unavailable",
	);
	expect(errorMessage({ error: { unexpected: true } }, "Fallback")).toBe(
		"Fallback",
	);
});

test("preserves HTTP status when a proxy returns HTML", async () => {
	const response = new Response("<html>Unavailable</html>", { status: 503 });
	await expect(assertResponseOk(response)).rejects.toEqual(
		new ApiError("Request failed (503). Please try again.", 503),
	);
});
