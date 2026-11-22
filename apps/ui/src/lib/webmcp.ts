// WebMCP (https://webmachinelearning.github.io/webmcp/): pages describe what
// they can do as tools on `document.modelContext`. The dashboard assistant and
// any browser agent read the same registry.

export interface WebMcpToolAnnotations {
	readOnlyHint?: boolean;
	consequentialHint?: boolean;
	untrustedContentHint?: boolean;
}

export interface WebMcpToolDefinition {
	name: string;
	title?: string;
	description: string;
	inputSchema?: Record<string, unknown>;
	annotations?: WebMcpToolAnnotations;
	execute: (
		input: Record<string, unknown>,
		options: { signal: AbortSignal },
	) => Promise<unknown>;
}

export interface WebMcpTool {
	readonly name: string;
	readonly title: string;
	readonly description: string;
	readonly inputSchema: Record<string, unknown> | null;
	readonly annotations: WebMcpToolAnnotations | null;
	readonly origin: string;
}

export interface ModelContext extends EventTarget {
	registerTool: (
		tool: WebMcpToolDefinition,
		options?: { signal?: AbortSignal },
	) => Promise<void>;
	getTools: () => Promise<WebMcpTool[]>;
	executeTool: (
		tool: WebMcpTool,
		input?: Record<string, unknown>,
		options?: { signal?: AbortSignal },
	) => Promise<string>;
}

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

class PageModelContext extends EventTarget implements ModelContext {
	private readonly tools = new Map<string, WebMcpToolDefinition>();

	public constructor(private readonly native?: ModelContext) {
		super();
	}

	public async registerTool(
		tool: WebMcpToolDefinition,
		options: { signal?: AbortSignal } = {},
	): Promise<void> {
		if (!TOOL_NAME_PATTERN.test(tool.name)) {
			throw new DOMException(
				`Invalid tool name "${tool.name}"`,
				"InvalidStateError",
			);
		}
		if (this.tools.has(tool.name)) {
			throw new DOMException(
				`Tool "${tool.name}" is already registered`,
				"InvalidStateError",
			);
		}
		if (options.signal?.aborted) {
			return;
		}
		this.tools.set(tool.name, tool);
		options.signal?.addEventListener(
			"abort",
			() => {
				if (this.tools.get(tool.name) === tool) {
					this.tools.delete(tool.name);
					this.dispatchEvent(new Event("toolchange"));
				}
			},
			{ once: true },
		);
		this.dispatchEvent(new Event("toolchange"));
		// Browsers that ship WebMCP get the same tools for their own agents.
		await this.native?.registerTool(tool, options);
	}

	public async getTools(): Promise<WebMcpTool[]> {
		return Array.from(this.tools.values()).map((tool) => ({
			name: tool.name,
			title: tool.title ?? tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema ?? null,
			annotations: tool.annotations ?? null,
			origin: window.location.origin,
		}));
	}

	public async executeTool(
		tool: WebMcpTool,
		input: Record<string, unknown> = {},
		options: { signal?: AbortSignal } = {},
	): Promise<string> {
		const definition = this.tools.get(tool.name);
		if (!definition) {
			throw new DOMException(
				`Tool "${tool.name}" is not registered on this page`,
				"NotFoundError",
			);
		}
		const result = await definition.execute(input, {
			signal: options.signal ?? new AbortController().signal,
		});
		return JSON.stringify(result ?? null);
	}
}

function isModelContext(value: unknown): value is ModelContext {
	return (
		typeof value === "object" &&
		value !== null &&
		"registerTool" in value &&
		typeof value.registerTool === "function"
	);
}

let pageModelContext: PageModelContext | undefined;

/**
 * The page's tool registry. Installed as `document.modelContext` when the
 * browser has none, and mirrored into the native one when it does.
 */
export function getModelContext(): ModelContext {
	if (!pageModelContext) {
		const native: unknown = Reflect.get(document, "modelContext");
		if (isModelContext(native)) {
			pageModelContext = new PageModelContext(native);
		} else {
			pageModelContext = new PageModelContext();
			Object.defineProperty(document, "modelContext", {
				value: pageModelContext,
				configurable: true,
			});
		}
	}
	return pageModelContext;
}
