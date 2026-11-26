import type { DiagramPlugin } from "streamdown";

type MermaidInstance = ReturnType<DiagramPlugin["getMermaid"]>;
type MermaidConfig = NonNullable<Parameters<DiagramPlugin["getMermaid"]>[0]>;

let pendingConfig: MermaidConfig | undefined;

const instance: MermaidInstance = {
	initialize(config) {
		pendingConfig = config;
	},
	async render(id, source) {
		const { mermaid } = await import("@streamdown/mermaid");
		return await mermaid.getMermaid(pendingConfig).render(id, source);
	},
};

// Same shape as @streamdown/mermaid's plugin, but the plugin — and the
// multi-MB mermaid library it imports statically — loads only when a
// conversation actually renders a diagram, not with every chat bundle.
export const lazyMermaid: DiagramPlugin = {
	name: "mermaid",
	type: "diagram",
	language: "mermaid",
	getMermaid(config) {
		if (config) {
			pendingConfig = config;
		}
		return instance;
	},
};
