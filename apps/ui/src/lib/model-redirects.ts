// Models that were renamed: sub-pages (provider, uptime) exist at the
// new slug, so preserve the rest of the path.
export const renamedModelRedirects: Record<string, string> = {
	"qwen37-max": "qwen3.7-max",
	"seedream-4.0": "seedream-4-0",
	"grok-4-fast": "grok-4-fast-reasoning",
	"grok-4-1-fast": "grok-4-1-fast-reasoning",
};
// Models that were removed before the "deactivate, never delete"
// policy existed. Their pages are indexed, so 301 them (including any
// sub-pages) to the closest surviving model page.
export const removedModelRedirects: Record<string, string> = {
	"gpt-oss-20b-free": "/models/gpt-oss-20b",
	"gpt-4.1-free": "/models/gpt-4.1",
	"glm-4.5-air-free": "/models/glm-4.5-air",
	"llama-3.3-70b-instruct-free": "/models/llama-3.3-70b-instruct",
	"llama-4-scout-free": "/models/llama-4-scout",
	"llama-4-maverick-free": "/models/llama-4-maverick-17b-instruct",
	"kimi-k2-0905-free": "/models/kimi-k2",
	"kimi-k2-0905": "/models/kimi-k2",
	"deepseek-r1t2-chimera-free": "/models/deepseek-r1-0528",
	"mistral-7b-instruct-together": "/models",
	"mixtral-8x7b-instruct-together": "/models",
	"nemotron-nano-9b-v2": "/models",
};

export function isRedirectedModelId(id: string): boolean {
	const slug = id.toLowerCase();
	return (
		Object.hasOwn(renamedModelRedirects, slug) ||
		Object.hasOwn(removedModelRedirects, slug)
	);
}
