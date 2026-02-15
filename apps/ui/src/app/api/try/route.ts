import { getUser } from "@/lib/getUser";

export async function POST(req: Request) {
	const user = await getUser();
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const body = (await req.json()) as { prompt?: string };
	const prompt = body.prompt;
	if (!prompt || typeof prompt !== "string") {
		return Response.json({ error: "Missing prompt" }, { status: 400 });
	}

	const apiKey = process.env.LLM_Z_AI_API_KEY;
	if (!apiKey) {
		return Response.json(
			{ error: "Try-it feature is not configured" },
			{ status: 503 },
		);
	}

	// Call the ZAI free model directly, bypassing the gateway
	const res = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model: "glm-4.5-flash",
			messages: [{ role: "user", content: prompt }],
			max_tokens: 200,
		}),
	});

	const data = await res.json();

	if (!res.ok) {
		return Response.json(
			{ error: (data as { error?: string }).error || "Request failed" },
			{ status: res.status },
		);
	}

	return Response.json(data);
}
