export const runtime = "edge";

export async function GET() {
	try {
		const url =
			"https://api.llmgateway.io/v1/models?include_deactivated=false&exclude_deprecated=false";
		const res = await fetch(url, { cache: "no-store" });
		if (!res.ok) {
			return new Response(JSON.stringify({ error: "Failed to fetch models" }), {
				status: res.status,
			});
		}
		const data = await res.json();
		return new Response(JSON.stringify(data), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	} catch (err) {
		return new Response(JSON.stringify({ error: "Models fetch error" }), {
			status: 500,
		});
	}
}
