export type ProductId = "gateway" | "devpass" | "lounge" | "airside";

export interface Product {
	id: ProductId;
	name: string;
	tagline: string;
	docsUrl: string;
	appUrl: string;
	appLabel: string;
	accent: string;
	accentSoft: string;
}

export const products: Record<ProductId, Product> = {
	gateway: {
		id: "gateway",
		name: "LLM Gateway",
		tagline: "One OpenAI-compatible API for every model and provider.",
		docsUrl: "/",
		appUrl: "https://llmgateway.io/dashboard",
		appLabel: "Open dashboard",
		accent: "#3b82f6",
		accentSoft: "#1e3a8a",
	},
	devpass: {
		id: "devpass",
		name: "DevPass",
		tagline:
			"Flat monthly plans for Claude Code, Cursor, and every coding agent.",
		docsUrl: "/devpass",
		appUrl: "https://devpass.llmgateway.io/dashboard",
		appLabel: "Open DevPass",
		accent: "#10b981",
		accentSoft: "#064e3b",
	},
	lounge: {
		id: "lounge",
		name: "Lounge",
		tagline: "Chat, image, video, and voice with every model in one app.",
		docsUrl: "/lounge",
		appUrl: "https://lounge.llmgateway.io",
		appLabel: "Open Lounge",
		accent: "#f43f5e",
		accentSoft: "#881337",
	},
	airside: {
		id: "airside",
		name: "Airside",
		tagline: "List your models, file prices, and watch your traffic arrive.",
		docsUrl: "/airside",
		appUrl: "https://airside.llmgateway.io",
		appLabel: "Open Airside",
		accent: "#f59e0b",
		accentSoft: "#78350f",
	},
};

export const productOrder: ProductId[] = [
	"gateway",
	"devpass",
	"lounge",
	"airside",
];

export function productForPath(path: string): Product {
	const group = /^\((gateway|devpass|lounge|airside)\)\//.exec(path)?.[1];
	return products[(group as ProductId | undefined) ?? "gateway"];
}

const sectionLabels: Record<string, string> = {
	features: "Features",
	learn: "Knowledge base",
	guides: "Guides",
	developers: "Developer tools",
	resources: "Resources",
	integrations: "Integrations",
	migrations: "Migrations",
	"self-host": "Self-hosting",
};

export function sectionForPath(path: string): string {
	const segments = path.split("/").filter((s) => !/^\(.+\)$/.test(s));
	if (path.includes("(api)/")) {
		return "API reference";
	}
	if (segments.length > 1) {
		return sectionLabels[segments[0]] ?? "Docs";
	}
	return "Get started";
}
