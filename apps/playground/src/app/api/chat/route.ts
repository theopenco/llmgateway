import { createHmac } from "node:crypto";

import {
	streamText,
	generateImage,
	dynamicTool,
	jsonSchema,
	isStepCount,
	type ToolSet,
	type UIMessage,
	convertToModelMessages,
	JsonToSseTransformStream,
	createUIMessageStream,
	createUIMessageStreamResponse,
} from "ai";
import { cookies } from "next/headers";
import { z } from "zod";

import { getPlaygroundKeyForRequest } from "@/lib/constants";
import { getUser } from "@/lib/getUser";
import {
	describeImageGenerationError,
	getModelImageConfig,
} from "@/lib/image-gen";
import {
	isRecord,
	readNumber,
	readString,
	type PlaygroundMessageMetadata,
} from "@/lib/message-metadata";
import { createServerApiClient, fetchServerData } from "@/lib/server-api";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { getApiKeyHashSecret } from "@llmgateway/shared/api-key-hash";
import { getGatewayApiBaseUrl } from "@llmgateway/shared/gateway-url";
import {
	loungeConnectorIds,
	type LoungeConnectorId,
} from "@llmgateway/shared/lounge-connectors";
import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";

export const maxDuration = 300; // 5 minutes

interface PlaygroundMetadataFinishStepPart {
	type: "finish-step";
	response: {
		modelId: string;
		headers?: Record<string, string>;
	};
	usage: {
		inputTokens?: number;
		inputTokenDetails?: {
			cacheReadTokens?: number;
		};
		outputTokens?: number;
	};
	providerMetadata?: unknown;
}

type PlaygroundMetadataStreamPart =
	PlaygroundMetadataFinishStepPart | { type: string };

type GatewayResponseMetadata = Pick<
	PlaygroundMessageMetadata,
	"logId" | "organizationId" | "projectId" | "discount"
>;

function isPlaygroundMetadataFinishStepPart(
	part: PlaygroundMetadataStreamPart,
): part is PlaygroundMetadataFinishStepPart {
	return part.type === "finish-step" && "response" in part && "usage" in part;
}

function readLLMGatewayProvider(
	providerMetadata: unknown,
): Record<string, unknown> | undefined {
	if (!isRecord(providerMetadata)) {
		return undefined;
	}
	const llmgateway = providerMetadata.llmgateway;
	return isRecord(llmgateway) ? llmgateway : undefined;
}

function extractGatewayResponseMetadata(
	value: unknown,
): GatewayResponseMetadata | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const metadata = isRecord(value.metadata)
		? (value.metadata as Record<string, unknown>)
		: isRecord(value.responseMetadata)
			? (value.responseMetadata as Record<string, unknown>)
			: value;

	const gatewayMetadata: GatewayResponseMetadata = {
		logId: readString(metadata.log_id),
		organizationId: readString(metadata.organization_id),
		projectId: readString(metadata.project_id),
		discount: readNumber(metadata.discount),
	};

	if (
		!gatewayMetadata.logId &&
		!gatewayMetadata.organizationId &&
		!gatewayMetadata.projectId &&
		gatewayMetadata.discount === undefined
	) {
		return undefined;
	}

	return gatewayMetadata;
}

function mergeGatewayResponseMetadata(
	metadata: PlaygroundMessageMetadata | undefined,
	gatewayMetadata: GatewayResponseMetadata | undefined,
): PlaygroundMessageMetadata | undefined {
	if (!gatewayMetadata) {
		return metadata;
	}

	return {
		...(metadata ?? {}),
		...(gatewayMetadata.logId ? { logId: gatewayMetadata.logId } : {}),
		...(gatewayMetadata.organizationId
			? { organizationId: gatewayMetadata.organizationId }
			: {}),
		...(gatewayMetadata.projectId
			? { projectId: gatewayMetadata.projectId }
			: {}),
		...(gatewayMetadata.discount !== undefined
			? { discount: gatewayMetadata.discount }
			: {}),
	};
}

interface GatewaySourceCitation {
	url: string;
	title?: string;
}

// The gateway surfaces web search results as OpenAI-style `url_citation`
// annotations, which the AI SDK provider does not forward as source parts
// when streaming — so they are captured here from the raw SSE side-channel.
function extractUrlCitations(value: unknown): GatewaySourceCitation[] {
	if (!isRecord(value) || !Array.isArray(value.choices)) {
		return [];
	}

	const citations: GatewaySourceCitation[] = [];
	for (const choice of value.choices) {
		if (!isRecord(choice)) {
			continue;
		}
		for (const container of [choice.delta, choice.message]) {
			if (!isRecord(container) || !Array.isArray(container.annotations)) {
				continue;
			}
			for (const annotation of container.annotations) {
				if (
					!isRecord(annotation) ||
					annotation.type !== "url_citation" ||
					!isRecord(annotation.url_citation)
				) {
					continue;
				}
				const url = readString(annotation.url_citation.url);
				if (url) {
					citations.push({
						url,
						title: readString(annotation.url_citation.title),
					});
				}
			}
		}
	}

	return citations;
}

function createGatewayMetadataCaptureStream(
	onMetadata: (metadata: GatewayResponseMetadata) => void,
	onCitations?: (citations: GatewaySourceCitation[]) => void,
): TransformStream<Uint8Array, Uint8Array> {
	const decoder = new TextDecoder();
	let buffer = "";

	const parseEvents = (events: string[]) => {
		for (const event of events) {
			const data = event
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trimStart())
				.join("\n");
			if (!data || data === "[DONE]") {
				continue;
			}

			try {
				const parsed: unknown = JSON.parse(data);
				const metadata = extractGatewayResponseMetadata(parsed);
				if (metadata) {
					onMetadata(metadata);
				}
				if (onCitations) {
					const citations = extractUrlCitations(parsed);
					if (citations.length > 0) {
						onCitations(citations);
					}
				}
			} catch {
				// Ignore non-JSON stream events.
			}
		}
	};

	return new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			buffer += decoder.decode(chunk, { stream: true });
			const events = buffer.split("\n\n");
			buffer = events.pop() ?? "";
			parseEvents(events);
			controller.enqueue(chunk);
		},
		flush() {
			buffer += decoder.decode();
			if (buffer) {
				parseEvents([buffer]);
			}
		},
	});
}

function extractPlaygroundMessageMetadata(
	part: PlaygroundMetadataStreamPart,
): PlaygroundMessageMetadata | undefined {
	if (!isPlaygroundMetadataFinishStepPart(part)) {
		return undefined;
	}

	const llmgateway = readLLMGatewayProvider(part.providerMetadata);
	const llmgatewayUsage =
		llmgateway && isRecord(llmgateway.usage)
			? (llmgateway.usage as Record<string, unknown>)
			: undefined;
	const llmgatewayMetadata =
		llmgateway && isRecord(llmgateway.metadata)
			? (llmgateway.metadata as Record<string, unknown>)
			: llmgateway && isRecord(llmgateway.responseMetadata)
				? (llmgateway.responseMetadata as Record<string, unknown>)
				: llmgateway;

	const promptTokensDetails = llmgatewayUsage?.promptTokensDetails;
	const requestId = readString(part.response.headers?.["x-request-id"]);

	const metadata: PlaygroundMessageMetadata = {
		usedModel: part.response.modelId,
		...(requestId ? { requestId } : {}),
		...extractGatewayResponseMetadata(llmgatewayMetadata),
		usage: {
			inputTokens:
				readNumber(llmgatewayUsage?.promptTokens) ?? part.usage.inputTokens,
			// Prefer the gateway's cachedTokens (enriched metadata) over the AI SDK's
			// cacheReadTokens — the gateway has access to the actual billed token counts.
			cachedInputTokens: isRecord(promptTokensDetails)
				? readNumber(promptTokensDetails.cachedTokens)
				: part.usage.inputTokenDetails?.cacheReadTokens,
			outputTokens:
				readNumber(llmgatewayUsage?.completionTokens) ??
				part.usage.outputTokens,
			totalCost: readNumber(llmgatewayUsage?.cost),
		},
	};

	return metadata;
}

interface ImageFilePart {
	type: "file";
	url: string;
	mediaType: string;
}

function isImageFilePart(value: unknown): value is ImageFilePart {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const v = value as Record<string, unknown>;
	return (
		v.type === "file" &&
		typeof v.url === "string" &&
		typeof v.mediaType === "string" &&
		v.mediaType.startsWith("image/")
	);
}

// Joined text parts of the latest user message, e.g. for image prompts and
// knowledge base retrieval queries.
function getLastUserText(messages: UIMessage[]): string {
	const lastUserMessage = [...messages]
		.reverse()
		.find((m) => m.role === "user");
	if (!Array.isArray(lastUserMessage?.parts)) {
		return "";
	}
	return lastUserMessage.parts
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join("\n");
}

interface ChatRequestBody {
	messages: UIMessage[];
	model?: string;
	apiKey?: string;
	provider?: string; // optional provider override
	mode?: "image" | "chat"; // optional hint to force image generation path
	image_config?: {
		aspect_ratio?:
			| "auto"
			| "1:1"
			| "9:16"
			| "16:9"
			| "3:4"
			| "4:3"
			| "3:2"
			| "2:3"
			| "5:4"
			| "4:5"
			| "21:9"
			| "1:4"
			| "4:1"
			| "1:8"
			| "8:1";
		image_size?: "0.5K" | "1K" | "2K" | "4K" | string; // string for Alibaba WIDTHxHEIGHT format
		image_quality?: "auto" | "low" | "medium" | "high" | string;
		n?: number;
	};
	reasoning_effort?: "minimal" | "low" | "medium" | "high";
	web_search?: boolean;
	connector_ids?: LoungeConnectorId[];
	is_image_gen?: boolean;
	temporary_chat?: boolean;
	skill_instructions?: string;
	project_id?: string;
}

interface ProjectRetrievalResponse {
	project: {
		id: string;
		name: string;
		instructions: string;
	};
	chunks: {
		content: string;
		score: number;
		fileId: string;
		fileName: string;
	}[];
	memories: string[];
}

/**
 * Wrap an SSE body with periodic `: ping` comment lines so proxies and load
 * balancers don't cut the connection during long silent stretches (tool
 * calls, reasoning, image generation). Uses a push-based ReadableStream with
 * setInterval so pings flush independently of consumer backpressure.
 */
function withSseKeepalive(
	body: ReadableStream<Uint8Array | string>,
	intervalMs: number,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const reader = body.getReader();
	let keepaliveTimer: ReturnType<typeof setInterval> | undefined;

	return new ReadableStream<Uint8Array>({
		start(controller) {
			keepaliveTimer = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(": ping\n\n"));
				} catch {
					// Stream already closed, clean up.
					clearInterval(keepaliveTimer);
				}
			}, intervalMs);

			// Read upstream chunks in a loop and forward them.
			void (async () => {
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							clearInterval(keepaliveTimer);
							controller.close();
							return;
						}
						controller.enqueue(
							typeof value === "string" ? encoder.encode(value) : value,
						);
					}
				} catch (err) {
					clearInterval(keepaliveTimer);
					controller.error(err);
				}
			})();
		},
		cancel() {
			clearInterval(keepaliveTimer);
			void reader.cancel();
		},
	});
}

const KEEPALIVE_INTERVAL_MS = 15_000;

export async function POST(req: Request) {
	const user = await getUser();

	if (!user) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
		});
	}

	const body = await req.json();
	const {
		messages,
		model,
		apiKey,
		provider,
		image_config,
		reasoning_effort,
		web_search,
		connector_ids,
		is_image_gen,
		skill_instructions,
		project_id,
	}: ChatRequestBody = body;

	if (!messages || !Array.isArray(messages)) {
		return new Response(JSON.stringify({ error: "Missing messages" }), {
			status: 400,
		});
	}

	if (
		body.temporary_chat !== undefined &&
		typeof body.temporary_chat !== "boolean"
	) {
		return new Response(JSON.stringify({ error: "Invalid temporary_chat" }), {
			status: 400,
		});
	}

	if (
		skill_instructions !== undefined &&
		typeof skill_instructions !== "string"
	) {
		return new Response(
			JSON.stringify({ error: "Invalid skill_instructions" }),
			{ status: 400 },
		);
	}

	if (project_id !== undefined && typeof project_id !== "string") {
		return new Response(JSON.stringify({ error: "Invalid project_id" }), {
			status: 400,
		});
	}

	const headerApiKey = req.headers.get("x-llmgateway-key") ?? undefined;
	const headerModel = req.headers.get("x-llmgateway-model") ?? undefined;
	const noFallbackHeader = req.headers.get("x-no-fallback") ?? undefined;

	const cookieStore = await cookies();
	const cookieApiKey = getPlaygroundKeyForRequest(cookieStore);
	const finalApiKey = apiKey ?? headerApiKey ?? cookieApiKey;
	if (!finalApiKey) {
		return new Response(JSON.stringify({ error: "Missing API key" }), {
			status: 400,
		});
	}

	let latestGatewayResponseMetadata: GatewayResponseMetadata | undefined;
	const captureGatewayMetadata = (metadata: GatewayResponseMetadata) => {
		latestGatewayResponseMetadata = {
			...latestGatewayResponseMetadata,
			...metadata,
		};
	};
	const collectedCitations: GatewaySourceCitation[] = [];
	const seenCitationUrls = new Set<string>();
	const captureGatewayCitations = (citations: GatewaySourceCitation[]) => {
		for (const citation of citations) {
			if (!seenCitationUrls.has(citation.url)) {
				seenCitationUrls.add(citation.url);
				collectedCitations.push(citation);
			}
		}
	};
	const gatewayFetch: typeof fetch = async (input, init) => {
		const response = await fetch(input, init);
		const contentType = response.headers.get("content-type") ?? "";

		if (contentType.includes("text/event-stream") && response.body) {
			const providerStream = response.body.pipeThrough(
				createGatewayMetadataCaptureStream(
					captureGatewayMetadata,
					captureGatewayCitations,
				),
			);

			return new Response(providerStream, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			});
		}

		if (contentType.includes("application/json")) {
			void response
				.clone()
				.json()
				.then((json: unknown) => {
					const metadata = extractGatewayResponseMetadata(json);
					if (metadata) {
						captureGatewayMetadata(metadata);
					}
				})
				.catch(() => {
					// Ignore JSON parsing errors in the metadata side-channel.
				});
		}

		return response;
	};

	const llmgateway = createLLMGateway({
		apiKey: finalApiKey,
		baseURL: getGatewayApiBaseUrl(),
		fetch: gatewayFetch,
		headers: {
			"x-source": LOUNGE_SOURCE,
			...(noFallbackHeader ? { "x-no-fallback": noFallbackHeader } : {}),
		},
		extraBody: {
			reasoning_effort,
			image_config,
			web_search,
		},
	}) as any;

	// Respect canonical model IDs passed from the client without adding a provider prefix.
	// Only apply provider-based prefixing when the client did NOT explicitly specify a model
	// (i.e. we're using a header/default model value).
	let selectedModel = (model ?? headerModel ?? "auto") as string;
	if (!model && provider && typeof provider === "string") {
		const alreadyPrefixed = String(selectedModel).includes("/");
		if (!alreadyPrefixed) {
			selectedModel = `${provider}/${selectedModel}`;
		}
	}

	// Use generateImage for image generation models in chat mode
	if (is_image_gen) {
		try {
			const maxInputImages = getModelImageConfig(selectedModel).maxInputImages;

			const lastUserMessage = [...messages]
				.reverse()
				.find((m) => m.role === "user");
			let prompt = "";
			const fileParts: { url: string; mediaType: string }[] = [];
			if (lastUserMessage) {
				if (Array.isArray(lastUserMessage.parts)) {
					prompt = getLastUserText(messages);
					for (const p of lastUserMessage.parts) {
						if (fileParts.length >= maxInputImages) {
							break;
						}
						if (isImageFilePart(p)) {
							fileParts.push({
								url: p.url,
								mediaType: p.mediaType,
							});
						}
					}
				}
			}

			// If the current user message did not upload any images, fall back to
			// the most recent assistant-generated image(s) so that follow-up prompts
			// can edit the previously generated output.
			if (fileParts.length === 0) {
				const lastAssistantWithImage = [...messages]
					.reverse()
					.find(
						(m) =>
							m.role === "assistant" &&
							Array.isArray(m.parts) &&
							m.parts.some(isImageFilePart),
					);
				if (
					lastAssistantWithImage &&
					Array.isArray(lastAssistantWithImage.parts)
				) {
					for (const p of lastAssistantWithImage.parts) {
						if (fileParts.length >= maxInputImages) {
							break;
						}
						if (isImageFilePart(p)) {
							fileParts.push({
								url: p.url,
								mediaType: p.mediaType,
							});
						}
					}
				}
			}

			if (!prompt.trim()) {
				return new Response(
					JSON.stringify({ error: "Missing prompt for image generation" }),
					{ status: 400 },
				);
			}

			// Kick off generation without awaiting so the stream response (and
			// its SSE bytes) starts flowing immediately. Image generation can
			// run for minutes (gpt-image-2 at high quality); awaiting here
			// buffers the whole response and lets proxies kill the idle
			// connection while the gateway request still completes.
			const generation = generateImage({
				model: llmgateway.image(selectedModel),
				prompt:
					fileParts.length > 0
						? { images: fileParts.map((fp) => fp.url), text: prompt }
						: prompt,
				n: image_config?.n ?? 1,
				...(image_config?.image_size
					? { size: image_config.image_size as `${number}x${number}` }
					: {}),
				...(image_config?.aspect_ratio && image_config.aspect_ratio !== "auto"
					? { aspectRatio: image_config.aspect_ratio }
					: {}),
				...(image_config?.image_quality
					? {
							providerOptions: {
								llmgateway: { quality: image_config.image_quality },
							},
						}
					: {}),
			});
			// Safety net: nothing awaits `generation` until execute() runs, so
			// attach a no-op rejection handler in case stream setup throws
			// first. execute still awaits the original promise, so errors
			// reach onError as usual.
			generation.catch(() => {});

			const stream = createUIMessageStream({
				execute: async ({ writer }) => {
					writer.write({
						type: "start",
						messageId: crypto.randomUUID(),
					});
					writer.write({ type: "start-step" });
					const result = await generation;
					for (const image of result.images) {
						const mediaType = image.mediaType || "image/png";
						writer.write({
							type: "file",
							url: `data:${mediaType};base64,${image.base64}`,
							mediaType,
						});
					}
					writer.write({ type: "finish-step" });
					writer.write({ type: "finish", finishReason: "stop" });
				},
				onError: (error) => describeImageGenerationError(error).message,
			});

			// Mirror the chat path's SSE keepalive so proxies don't cut the
			// connection while the image model works.
			const sseResponse = createUIMessageStreamResponse({ stream });
			const upstreamBody = sseResponse.body;
			if (!upstreamBody) {
				return sseResponse;
			}

			return new Response(
				withSseKeepalive(upstreamBody, KEEPALIVE_INTERVAL_MS),
				{
					status: sseResponse.status,
					headers: sseResponse.headers,
				},
			);
		} catch (error: unknown) {
			const { message, status } = describeImageGenerationError(error);
			return new Response(JSON.stringify({ error: message }), { status });
		}
	}

	// Project (knowledge base) context: retrieve the chunks most relevant to
	// the latest user message plus the project's instructions and memories, and
	// prepend them to the system prompt. Retrieval failures degrade to a normal
	// chat.
	let projectContext: string | undefined;
	// Kept for memory extraction after the stream finishes.
	let projectQueryText = "";
	if (project_id) {
		projectQueryText = getLastUserText(messages).slice(0, 10_000);
		const retrieval = await fetchServerData<ProjectRetrievalResponse>(
			"POST",
			"/chat-projects/{id}/retrieve",
			{
				params: { path: { id: project_id } },
				body: {
					query: projectQueryText.trim() || "Project knowledge base overview",
				},
				// Bill the query embedding to the same gateway key as the chat.
				headers: { "x-llmgateway-key": finalApiKey },
				// Don't let a slow retrieval stall the chat; on timeout the
				// request proceeds without project context.
				signal: AbortSignal.timeout(15_000),
			},
		);
		if (retrieval) {
			const sections: string[] = [];
			if (retrieval.project.instructions.trim()) {
				sections.push(
					`Project instructions:\n${retrieval.project.instructions}`,
				);
			}
			if (retrieval.memories?.length) {
				sections.push(
					`Project memory — durable facts saved from earlier chats in this project:\n${retrieval.memories
						.map((memory) => `- ${memory}`)
						.join("\n")}`,
				);
			}
			if (retrieval.chunks.length) {
				sections.push(
					`Relevant excerpts from the project's knowledge base files. Ground your answer in these excerpts and mention the source file when you use one:\n\n${retrieval.chunks
						.map((chunk) => `[Source: ${chunk.fileName}]\n${chunk.content}`)
						.join("\n\n---\n\n")}`,
				);
			}
			if (sections.length) {
				projectContext = `You are answering inside the project "${retrieval.project.name}".\n\n${sections.join("\n\n")}`;
			}
		}
	}

	if ("mcp_servers" in body) {
		return Response.json(
			{ error: "Custom MCP servers are no longer supported. Use Connectors." },
			{ status: 400 },
		);
	}
	const selectedConnectors = z
		.array(z.enum(loungeConnectorIds))
		.max(loungeConnectorIds.length)
		.safeParse(connector_ids ?? []);
	if (!selectedConnectors.success) {
		return Response.json({ error: "Invalid connectors" }, { status: 400 });
	}
	try {
		const allTools: ToolSet = {};
		if (selectedConnectors.data.length) {
			const client = await createServerApiClient();
			const response = await client.POST("/connectors/tools", {
				body: { connectors: selectedConnectors.data },
				signal: req.signal,
			});
			if (!response.data) {
				return Response.json(
					{
						error:
							"Could not load your connectors. Reconnect or pause them and try again.",
					},
					{ status: response.response.status },
				);
			}
			for (const definition of response.data.tools) {
				const name = `${definition.connectorId.replaceAll("-", "_")}__${definition.name}`;
				allTools[name] = dynamicTool({
					description: `${definition.connectorId}: ${definition.description}`,
					inputSchema: jsonSchema<Record<string, unknown>>(
						definition.inputSchema,
					),
					execute: async (input) => {
						const parsed = z.record(z.string(), z.unknown()).parse(input);
						const result = await client.POST(
							"/connectors/{connectorId}/tools/{toolName}",
							{
								params: {
									path: {
										connectorId: definition.connectorId,
										toolName: definition.name,
									},
								},
								body: { input: parsed },
								signal: req.signal,
							},
						);
						if (!result.data) {
							throw new Error(
								"The connector could not complete this request. Try reconnecting it.",
							);
						}
						const output: unknown = JSON.parse(result.data.result);
						return output;
					},
				});
			}
		}

		const hasTools = Object.keys(allTools).length > 0;

		// Streaming chat with optional MCP tools
		const existingSystem = messages
			.filter((m) => m.role === "system")
			.map((m) =>
				m.parts
					.filter(
						(p): p is Extract<typeof p, { type: "text" }> => p.type === "text",
					)
					.map((p) => p.text)
					.join(""),
			)
			.join("\n\n");
		const resolvedSystem =
			[existingSystem, skill_instructions, projectContext]
				.filter(Boolean)
				.join("\n\n") || undefined;
		const result = streamText({
			model: llmgateway.chat(selectedModel, { usage: { include: true } }),
			messages: await convertToModelMessages(
				messages.filter((m) => m.role !== "system"),
			),
			...(resolvedSystem ? { instructions: resolvedSystem } : {}),
			...(hasTools
				? {
						tools: allTools,
						stopWhen: isStepCount(10),
						toolApproval: () => "user-approval" as const,
						experimental_toolApprovalSecret: createHmac(
							"sha256",
							getApiKeyHashSecret(),
						)
							.update(`lounge-tools:${user.id}`)
							.digest("hex"),
					}
				: {}),
			onEnd: async ({ text }) => {
				// Fire-and-forget memory extraction from this exchange; failures
				// never affect the chat response.
				if (
					project_id &&
					body.temporary_chat !== true &&
					projectQueryText.trim() &&
					text?.trim()
				) {
					void fetchServerData("POST", "/chat-projects/{id}/memories/extract", {
						params: { path: { id: project_id } },
						body: {
							userMessage: projectQueryText.slice(0, 8000),
							assistantMessage: text.slice(0, 8000),
						},
						// Bill the extraction model call to the same gateway key
						// as the chat.
						headers: { "x-llmgateway-key": finalApiKey },
						signal: AbortSignal.timeout(90_000),
					});
				}
			},
		});

		// Build the UI message stream and pipe through SSE formatting
		let latestMessageMetadata: PlaygroundMessageMetadata | undefined;
		const uiStream = result.toUIMessageStream({
			originalMessages: messages,
			sendReasoning: true,
			sendSources: true,
			messageMetadata: ({ part }) => {
				if (part.type === "finish") {
					return mergeGatewayResponseMetadata(
						latestMessageMetadata,
						latestGatewayResponseMetadata,
					);
				}
				const metadata = mergeGatewayResponseMetadata(
					extractPlaygroundMessageMetadata(part),
					latestGatewayResponseMetadata,
				);
				if (metadata) {
					latestMessageMetadata = metadata;
				}
				return undefined;
			},
		});
		// The provider drops gateway web-search annotations when streaming, so
		// citations captured from the raw SSE are re-emitted as source-url parts
		// at the end of each step, where the UI renders them as Sources.
		type PlaygroundUIMessageChunk =
			typeof uiStream extends ReadableStream<infer TChunk> ? TChunk : never;
		let emittedCitationCount = 0;
		const uiStreamWithSources = uiStream.pipeThrough(
			new TransformStream<PlaygroundUIMessageChunk, PlaygroundUIMessageChunk>({
				transform(chunk, controller) {
					if (chunk.type === "finish-step") {
						while (emittedCitationCount < collectedCitations.length) {
							const citation = collectedCitations[emittedCitationCount];
							controller.enqueue({
								type: "source-url",
								sourceId: `gateway-citation-${emittedCitationCount}`,
								url: citation.url,
								...(citation.title ? { title: citation.title } : {}),
							} as PlaygroundUIMessageChunk);
							emittedCitationCount++;
						}
					}
					controller.enqueue(chunk);
				},
			}),
		);
		const sseStream = uiStreamWithSources.pipeThrough(
			new JsonToSseTransformStream(),
		);

		// Add SSE keepalive comments (`: ping`) to prevent proxy/load balancer
		// timeouts on long-running requests (e.g. tool calls, reasoning).
		const streamWithKeepalive = withSseKeepalive(
			sseStream,
			KEEPALIVE_INTERVAL_MS,
		);

		return new Response(streamWithKeepalive, {
			headers: {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
				"x-vercel-ai-ui-message-stream": "v1",
				"x-accel-buffering": "no",
			},
		});
	} catch (error: unknown) {
		const message =
			error instanceof Error ? error.message : "LLM Gateway request failed";
		const status =
			typeof error === "object" &&
			error !== null &&
			"status" in error &&
			typeof (error as { status: unknown }).status === "number"
				? (error as { status: number }).status
				: 500;
		return new Response(JSON.stringify({ error: message }), {
			status,
		});
	}
}
