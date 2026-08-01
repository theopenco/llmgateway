import {
	streamText,
	convertToModelMessages,
	createUIMessageStream,
	JsonToSseTransformStream,
	tool,
	stepCountIs,
	type UIMessage,
} from "ai";
import { Hono } from "hono";
import { z } from "zod";

import { redisClient } from "@/auth/config.js";
import {
	fetchKnowledgePage,
	getKnowledgeUrls,
} from "@/utils/chat-support-knowledge.js";
import { notifyChatSupportEscalation } from "@/utils/discord.js";
import { sendTransactionalEmail } from "@/utils/email.js";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { and, db, desc, eq, isNull, tables } from "@llmgateway/db";
import { logger, toError } from "@llmgateway/logger";
import { replyToEmail } from "@llmgateway/shared/email";

import type { ServerTypes } from "@/vars.js";

function escapeHtml(text: string): string {
	const htmlEscapeMap: Record<string, string> = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#x27;",
	};
	return text.replace(/[&<>"']/g, (char) => htmlEscapeMap[char] || char);
}

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60; // 1 hour
// A short burst window on top of the hourly cap so a single visitor can't
// fire dozens of messages in a couple of seconds (the hourly cap alone allows
// the entire quota to be spent instantly).
const BURST_LIMIT_MAX = 5;
const BURST_LIMIT_WINDOW_SECONDS = 20;
// Daily cap on top of the hourly one — 20/hour alone still allows 480 LLM
// calls per day from a single address grinding the window all day.
const DAILY_LIMIT_MAX = 60;
const DAILY_LIMIT_WINDOW_SECONDS = 24 * 60 * 60;
// Global circuit breakers across all visitors. Per-identifier limits are
// defeated by rotating IPs (or spoofed forwarding headers on direct API
// hits), so these bound the total LLM spend no matter how the per-IP and
// per-client buckets are evaded.
const GLOBAL_HOURLY_LIMIT_MAX = 300;
const GLOBAL_DAILY_LIMIT_MAX = 1500;
// Escalations send an email and a Discord ping each, so they get their own
// daily per-IP cap plus a global cap to keep a flood from burying the inbox.
const ESCALATE_DAILY_LIMIT_MAX = 10;
const ESCALATE_GLOBAL_DAILY_LIMIT_MAX = 50;
// Shared per-IP budget for the cheap DB-backed endpoints (conversation
// restore, reactions, ratings) — generous for humans, stops hammering.
const META_BURST_LIMIT_MAX = 30;
const META_HOURLY_LIMIT_MAX = 300;
const CONVERSATION_TTL_SECONDS = 60 * 60; // 1 hour
const MAX_CONTEXT_MESSAGES = 30;

const DOCS_BASE_URL = "https://docs.llmgateway.io";

const BASE_SYSTEM_PROMPT = `You are the LLM Gateway support assistant. You ONLY answer questions related to LLM Gateway — the unified API gateway for multiple LLM providers — and its products (the dashboard at llmgateway.io, DevPass at devpass.llmgateway.io, the docs at docs.llmgateway.io, and the chat app at chat.llmgateway.io).

Your knowledge covers:
- Getting started, quick start, and setup
- API endpoints: /v1/chat/completions, /v1/messages, /v1/models, /v1/moderations, /v1/videos
- Features: routing, caching, response healing, vision, image generation, video generation, web search, reasoning, guardrails, audit logs, cost breakdown, data retention, metadata, custom providers, API keys, moderations
- Guides: Cursor, Cline, Claude Code, Codex CLI, OpenCode, Autohand, CLI, MCP, n8n, Agent Skills, OpenClaw
- Integrations: AWS Bedrock, Azure
- Migrations: from OpenRouter, LiteLLM, Vercel AI Gateway
- Learning: dashboard, API keys, playground, billing, activity, usage metrics, model usage, transactions, team, org preferences, preferences, provider keys, referrals, security events, guardrails, audit logs, policies
- DevPass subscription plans
- Self-hosting
- Rate limits and resources

When answering:
1. Be concise and helpful.
2. Link to relevant pages using the real URLs listed in the "Available pages" section below. Never invent URLs.
3. When you are unsure of an answer or need exact details, use the \`fetchPage\` tool to read the most relevant page before answering. Prefer grounding your answer in fetched content.
4. If the question is NOT related to LLM Gateway, politely decline and suggest they ask about LLM Gateway features instead.
5. Do not make up features or capabilities. If unsure after checking the docs, direct them to ${DOCS_BASE_URL} or suggest contacting support at contact@llmgateway.io.
6. Keep responses short — ideally under 200 words.`;

async function buildSystemPrompt(): Promise<string> {
	const urls = await getKnowledgeUrls();
	if (urls.length === 0) {
		return BASE_SYSTEM_PROMPT;
	}
	const urlList = urls.map((u) => `- ${u}`).join("\n");
	return `${BASE_SYSTEM_PROMPT}

Available pages (sourced from the live sitemaps of llmgateway.io, devpass.llmgateway.io, docs.llmgateway.io and chat.llmgateway.io). Use these for accurate links and as targets for the \`fetchPage\` tool:
${urlList}`;
}

function extractClientIP(c: {
	req: { header: (name: string) => string | undefined };
}): string | null {
	const cfConnectingIP = c.req.header("CF-Connecting-IP");
	if (cfConnectingIP) {
		return cfConnectingIP;
	}
	const xForwardedFor = c.req.header("X-Forwarded-For");
	if (xForwardedFor) {
		return xForwardedFor.split(",")[0]?.trim() ?? null;
	}
	return c.req.header("X-Real-IP") ?? null;
}

async function checkRateLimit(
	identifier: string,
	bucket: string,
	max: number,
	windowSeconds: number,
): Promise<boolean> {
	const key = `chat_support_rate_limit:${bucket}:${identifier}`;
	try {
		const count = await redisClient.incr(key);
		if (count === 1) {
			await redisClient.expire(key, windowSeconds);
		}
		return count <= max;
	} catch (error) {
		logger.error("Chat support rate limit check failed", toError(error));
		return true;
	}
}

// Enforces the burst, hourly and daily windows per IP and per clientId, then
// the global circuit breakers. Narrower windows run first so a request they
// block doesn't consume the wider quotas, and the global buckets run last so
// per-identifier rejections don't eat into everyone else's budget. The
// clientId is client-chosen, so it can't be the only key — but it catches
// bots that rotate IPs while reusing a client identity, and the global caps
// bound whatever rotates both.
async function checkMessageRateLimit(
	ipAddress: string,
	clientId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
	const identifiers = [`ip:${ipAddress}`, `client:${clientId}`];

	for (const identifier of identifiers) {
		const burstOk = await checkRateLimit(
			identifier,
			"burst",
			BURST_LIMIT_MAX,
			BURST_LIMIT_WINDOW_SECONDS,
		);
		if (!burstOk) {
			return {
				ok: false,
				message:
					"You're sending messages too quickly. Please wait a few seconds and try again.",
			};
		}
	}
	for (const identifier of identifiers) {
		const hourOk = await checkRateLimit(
			identifier,
			"hour",
			RATE_LIMIT_MAX,
			RATE_LIMIT_WINDOW_SECONDS,
		);
		if (!hourOk) {
			return {
				ok: false,
				message: "Too many messages. Please try again later (max 20 per hour).",
			};
		}
	}
	for (const identifier of identifiers) {
		const dayOk = await checkRateLimit(
			identifier,
			"day",
			DAILY_LIMIT_MAX,
			DAILY_LIMIT_WINDOW_SECONDS,
		);
		if (!dayOk) {
			return {
				ok: false,
				message:
					"Daily message limit reached. Please try again tomorrow or email contact@llmgateway.io.",
			};
		}
	}

	const globalHourOk = await checkRateLimit(
		"all",
		"global_hour",
		GLOBAL_HOURLY_LIMIT_MAX,
		RATE_LIMIT_WINDOW_SECONDS,
	);
	const globalDayOk =
		globalHourOk &&
		(await checkRateLimit(
			"all",
			"global_day",
			GLOBAL_DAILY_LIMIT_MAX,
			DAILY_LIMIT_WINDOW_SECONDS,
		));
	if (!globalDayOk) {
		logger.warn("Chat support global rate limit reached", { ipAddress });
		return {
			ok: false,
			message:
				"Chat support is experiencing unusually high volume. Please try again later or email contact@llmgateway.io.",
		};
	}

	return { ok: true };
}

// Shared limiter for the cheap DB-backed endpoints. One bucket across all of
// them: none is expensive on its own, the goal is just to stop hammering.
async function checkMetaRateLimit(ipAddress: string): Promise<boolean> {
	const burstOk = await checkRateLimit(
		`ip:${ipAddress}`,
		"meta_burst",
		META_BURST_LIMIT_MAX,
		BURST_LIMIT_WINDOW_SECONDS,
	);
	if (!burstOk) {
		return false;
	}
	return await checkRateLimit(
		`ip:${ipAddress}`,
		"meta_hour",
		META_HOURLY_LIMIT_MAX,
		RATE_LIMIT_WINDOW_SECONDS,
	);
}

function getTextFromUIMessage(message: UIMessage): string {
	return message.parts
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join("");
}

// Redis is a best-effort cache for clientId → conversationId. If it's
// unavailable the request still completes via the DB-backed lookup, so these
// helpers swallow failures instead of propagating them.
async function safeRedisGet(key: string): Promise<string | null> {
	try {
		return await redisClient.get(key);
	} catch (error) {
		logger.error("Chat support Redis get failed", toError(error));
		return null;
	}
}

async function safeRedisSetConversation(
	key: string,
	value: string,
): Promise<void> {
	try {
		await redisClient.set(key, value, "EX", CONVERSATION_TTL_SECONDS);
	} catch (error) {
		logger.error("Chat support Redis set failed", toError(error));
	}
}

// Resolves the active (non-archived) conversation for a client. Archived
// conversations are intentionally treated as gone so the visitor starts fresh.
async function findActiveConversationId(
	clientId: string,
): Promise<string | null> {
	const redisKey = `chat_support_conv:${clientId}`;
	const t = tables.chatSupportConversation;

	const cachedId = await safeRedisGet(redisKey);
	if (cachedId) {
		const rows = await db
			.select({ id: t.id, archivedAt: t.archivedAt })
			.from(t)
			.where(eq(t.id, cachedId))
			.limit(1);
		if (rows[0] && !rows[0].archivedAt) {
			return cachedId;
		}
	}

	const rows = await db
		.select({ id: t.id })
		.from(t)
		.where(and(eq(t.clientId, clientId), isNull(t.archivedAt)))
		.orderBy(desc(t.createdAt))
		.limit(1);

	const found = rows[0]?.id ?? null;
	if (found) {
		await safeRedisSetConversation(redisKey, found);
	}
	return found;
}

async function createNewConversation(
	clientId: string,
	ipAddress: string,
	userAgent: string | undefined,
	name: string | undefined,
	email: string | undefined,
): Promise<string> {
	const t = tables.chatSupportConversation;
	const [conv] = await db
		.insert(t)
		.values({ clientId, ipAddress, userAgent, name, email, messageCount: 0 })
		.returning({ id: t.id });
	const conversationId = conv!.id;

	await safeRedisSetConversation(
		`chat_support_conv:${clientId}`,
		conversationId,
	);
	return conversationId;
}

async function getOrCreateConversation(
	clientId: string,
	ipAddress: string,
	userAgent: string | undefined,
	name: string | undefined,
	email: string | undefined,
): Promise<string> {
	const existingId = await findActiveConversationId(clientId);
	if (existingId) {
		if (name || email) {
			const t = tables.chatSupportConversation;
			await db
				.update(t)
				.set({
					...(name ? { name } : {}),
					...(email ? { email } : {}),
				})
				.where(eq(t.id, existingId));
		}
		return existingId;
	}

	return await createNewConversation(
		clientId,
		ipAddress,
		userAgent,
		name,
		email,
	);
}

// Appends a single message at the next sequence. Persisting the user turn and
// the assistant turn independently means a user's message is never lost when
// the assistant fails or a human has taken the conversation over — prior
// messages (including admin replies) are already stored and never rewritten, so
// the sequence stays contiguous regardless of what history the client echoes.
async function persistMessage(
	conversationId: string,
	role: "user" | "assistant",
	content: string,
): Promise<void> {
	if (!content) {
		return;
	}
	try {
		const t = tables.chatSupportConversation;
		const mt = tables.chatSupportMessage;

		await db.transaction(async (tx) => {
			const [conv] = await tx
				.select({ messageCount: t.messageCount })
				.from(t)
				.where(eq(t.id, conversationId))
				.limit(1);
			const sequence = conv?.messageCount ?? 0;

			await tx.insert(mt).values({ conversationId, role, content, sequence });
			await tx
				.update(t)
				.set({ messageCount: sequence + 1, archivedAt: null })
				.where(eq(t.id, conversationId));
		});
	} catch (error) {
		logger.error("Failed to persist chat support message", toError(error));
	}
}

// The endpoint is public and unauthenticated, so the body is fully untrusted.
// A UIMessage's `parts` array is required by both getTextFromUIMessage and the
// AI SDK's convertToModelMessages downstream, so validate the whole shape up
// front and reject anything malformed instead of crashing deeper in the flow.
const chatSupportMessageSchema = z.object({
	id: z.string().optional(),
	role: z.string(),
	parts: z.array(z.object({ type: z.string() }).passthrough()),
	metadata: z.unknown().optional(),
});

const chatSupportRequestSchema = z.object({
	// Longer histories are allowed now that conversations persist across
	// sessions, but only the most recent messages are fed to the model to bound
	// token usage (see MAX_CONTEXT_MESSAGES below).
	messages: z
		.array(chatSupportMessageSchema)
		.min(1, "Missing messages")
		.max(100, "Too many messages in conversation"),
	name: z.string().max(200).optional(),
	email: z.string().max(320).optional(),
	clientId: z.string().min(1).max(64),
});

export const publicChatSupport = new Hono<ServerTypes>();

publicChatSupport.post("/", async (c) => {
	const ipAddress = extractClientIP(c) ?? "unknown";

	const parsed = chatSupportRequestSchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!parsed.success) {
		return c.json(
			{ error: parsed.error.issues[0]?.message ?? "Invalid request body" },
			400,
		);
	}
	const { name, email, clientId } = parsed.data;
	const messages = parsed.data.messages as unknown as UIMessage[];

	// Checked only after validation so malformed requests can't consume the
	// per-identifier buckets — or worse, trip the global breaker for free.
	const rateLimit = await checkMessageRateLimit(ipAddress, clientId);
	if (!rateLimit.ok) {
		return c.json({ error: rateLimit.message }, 429);
	}

	const contextMessages = messages.slice(-MAX_CONTEXT_MESSAGES);

	const userAgent = c.req.header("User-Agent");
	const conversationId = await getOrCreateConversation(
		clientId,
		ipAddress,
		userAgent,
		name,
		email,
	);

	// Persist the visitor's message up front so it is never lost if the assistant
	// errors or a human has taken the conversation over.
	const newUserMessage = [...messages].reverse().find((m) => m.role === "user");
	if (newUserMessage) {
		await persistMessage(
			conversationId,
			"user",
			getTextFromUIMessage(newUserMessage),
		);
	}

	// Once a visitor escalates to a human, the AI stays silent — only admins
	// reply from here on. We still persist the visitor's message above so the
	// support team sees it, then return an empty stream so the widget settles
	// without producing an assistant turn.
	const ct = tables.chatSupportConversation;
	const [escalationRow] = await db
		.select({ escalatedAt: ct.escalatedAt })
		.from(ct)
		.where(eq(ct.id, conversationId))
		.limit(1);
	if (escalationRow?.escalatedAt) {
		const noopStream = createUIMessageStream<UIMessage>({
			execute: () => {
				// Intentionally empty — escalated conversations get no AI reply.
			},
		});
		return new Response(
			noopStream.pipeThrough(new JsonToSseTransformStream()),
			{
				headers: {
					"content-type": "text/event-stream",
					"cache-control": "no-cache, no-transform",
					connection: "keep-alive",
					"x-vercel-ai-ui-message-stream": "v1",
					"x-accel-buffering": "no",
				},
			},
		);
	}

	const gatewayUrl = process.env.GATEWAY_URL ?? "https://api.llmgateway.io/v1";

	const supportApiKey = process.env.SUPPORT_CHAT_API_KEY;
	if (!supportApiKey) {
		logger.error("SUPPORT_CHAT_API_KEY not configured");
		return c.json({ error: "Chat support is not configured" }, 503);
	}

	const llmgateway = createLLMGateway({
		apiKey: supportApiKey,
		baseURL: gatewayUrl,
		headers: {
			"x-source": "support-chat",
		},
	});

	const system = await buildSystemPrompt();

	const result = streamText({
		model: llmgateway.chat("auto"),
		system,
		messages: await convertToModelMessages(contextMessages),
		maxOutputTokens: 1024,
		stopWhen: stepCountIs(4),
		tools: {
			fetchPage: tool({
				description:
					"Fetch the readable text content of an LLM Gateway page (llmgateway.io, devpass/docs/chat.llmgateway.io) to ground your answer in accurate, up-to-date information. Pass a full https URL from the available pages list.",
				inputSchema: z.object({
					url: z
						.string()
						.describe("Full https URL of the LLM Gateway page to read"),
				}),
				execute: async ({ url }) => await fetchKnowledgePage(url),
			}),
		},
		async onFinish({ text }) {
			await persistMessage(conversationId, "assistant", text);
		},
	});

	// Pipe the UI message stream through SSE. SSE (`text/event-stream`) is far
	// more reliable than raw `text/plain` streams on mobile Safari and through
	// intermediate proxies, which tend to buffer `text/plain` responses and
	// surface as "Load failed" errors on iOS.
	const uiStream = result.toUIMessageStream({
		onError: (error) => {
			logger.error("Chat support streaming error", toError(error));
			return "Something went wrong. Please try again.";
		},
	});
	const sseStream = uiStream.pipeThrough(new JsonToSseTransformStream());

	// Emit keepalive SSE comments so long-running streams aren't torn down by
	// proxies/load balancers before the first chunk is flushed.
	const KEEPALIVE_INTERVAL_MS = 15_000;
	const encoder = new TextEncoder();
	const reader = sseStream.getReader();
	const streamWithKeepalive = new ReadableStream<Uint8Array>({
		start(controller) {
			const keepalive = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(": ping\n\n"));
				} catch {
					clearInterval(keepalive);
				}
			}, KEEPALIVE_INTERVAL_MS);

			void (async () => {
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							clearInterval(keepalive);
							controller.close();
							return;
						}
						controller.enqueue(encoder.encode(value));
					}
				} catch (err) {
					clearInterval(keepalive);
					controller.error(err);
				}
			})();
		},
		cancel() {
			void reader.cancel();
		},
	});

	return new Response(streamWithKeepalive, {
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			"x-vercel-ai-ui-message-stream": "v1",
			"x-accel-buffering": "no",
		},
	});
});

// Returns the persisted, non-archived conversation for a client so the widget
// can restore history across reloads and surface admin replies. Archived
// conversations resolve to an empty result — they are hidden from the visitor.
publicChatSupport.get("/conversation", async (c) => {
	if (!(await checkMetaRateLimit(extractClientIP(c) ?? "unknown"))) {
		return c.json({ error: "Too many requests. Please try again later." }, 429);
	}

	const clientId = c.req.query("clientId");
	if (!clientId || clientId.length > 64) {
		return c.json({ error: "Missing or invalid clientId" }, 400);
	}

	const conversationId = await findActiveConversationId(clientId);
	if (!conversationId) {
		return c.json({
			conversationId: null,
			messages: [],
			resolvedAt: null,
			rating: null,
			escalatedAt: null,
		});
	}

	const t = tables.chatSupportConversation;
	const mt = tables.chatSupportMessage;

	const [conv] = await db
		.select({
			id: t.id,
			resolvedAt: t.resolvedAt,
			rating: t.rating,
			escalatedAt: t.escalatedAt,
		})
		.from(t)
		.where(eq(t.id, conversationId))
		.limit(1);

	if (!conv) {
		return c.json({
			conversationId: null,
			messages: [],
			resolvedAt: null,
			rating: null,
			escalatedAt: null,
		});
	}

	const messages = await db
		.select({
			id: mt.id,
			role: mt.role,
			content: mt.content,
			sequence: mt.sequence,
			reaction: mt.reaction,
		})
		.from(mt)
		.where(eq(mt.conversationId, conversationId))
		.orderBy(mt.sequence);

	return c.json({
		conversationId: conv.id,
		resolvedAt: conv.resolvedAt?.toISOString() ?? null,
		rating: conv.rating ?? null,
		escalatedAt: conv.escalatedAt?.toISOString() ?? null,
		messages,
	});
});

// Records a thumbs up/down on a specific assistant message.
publicChatSupport.post("/reaction", async (c) => {
	if (!(await checkMetaRateLimit(extractClientIP(c) ?? "unknown"))) {
		return c.json({ error: "Too many requests. Please try again later." }, 429);
	}

	const body = await c.req.json<{
		clientId?: string;
		sequence?: number;
		reaction?: "like" | "dislike" | null;
	}>();
	const { clientId, sequence, reaction } = body;

	if (!clientId || clientId.length > 64) {
		return c.json({ error: "Missing or invalid clientId" }, 400);
	}
	if (typeof sequence !== "number" || sequence < 0) {
		return c.json({ error: "Missing or invalid sequence" }, 400);
	}
	if (reaction !== "like" && reaction !== "dislike" && reaction !== null) {
		return c.json({ error: "Invalid reaction" }, 400);
	}

	const conversationId = await findActiveConversationId(clientId);
	if (!conversationId) {
		return c.json({ error: "Conversation not found" }, 404);
	}

	const mt = tables.chatSupportMessage;
	const updated = await db
		.update(mt)
		.set({ reaction })
		.where(
			and(
				eq(mt.conversationId, conversationId),
				eq(mt.sequence, sequence),
				eq(mt.role, "assistant"),
			),
		)
		.returning({ id: mt.id });

	if (updated.length === 0) {
		return c.json({ error: "Assistant message not found" }, 404);
	}

	return c.json({ success: true });
});

// Lets the visitor resolve their conversation and rate it from 0 to 5 stars.
publicChatSupport.post("/resolve", async (c) => {
	if (!(await checkMetaRateLimit(extractClientIP(c) ?? "unknown"))) {
		return c.json({ error: "Too many requests. Please try again later." }, 429);
	}

	const body = await c.req.json<{
		clientId?: string;
		rating?: number;
	}>();
	const { clientId, rating } = body;

	if (!clientId || clientId.length > 64) {
		return c.json({ error: "Missing or invalid clientId" }, 400);
	}
	if (
		typeof rating !== "number" ||
		!Number.isInteger(rating) ||
		rating < 0 ||
		rating > 5
	) {
		return c.json({ error: "Rating must be an integer between 0 and 5" }, 400);
	}

	const conversationId = await findActiveConversationId(clientId);
	if (!conversationId) {
		return c.json({ error: "Conversation not found" }, 404);
	}

	const t = tables.chatSupportConversation;
	await db
		.update(t)
		.set({ resolvedAt: new Date(), rating })
		.where(eq(t.id, conversationId));

	return c.json({ success: true });
});

publicChatSupport.post("/escalate", async (c) => {
	const ipAddress = extractClientIP(c) ?? "unknown";
	// Throttle escalation on its own buckets — never the message buckets — so a
	// visitor who has used up their hourly message quota can still reach a human.
	const hourOk = await checkRateLimit(
		`ip:${ipAddress}`,
		"escalate",
		RATE_LIMIT_MAX,
		RATE_LIMIT_WINDOW_SECONDS,
	);
	const dayOk =
		hourOk &&
		(await checkRateLimit(
			`ip:${ipAddress}`,
			"escalate_day",
			ESCALATE_DAILY_LIMIT_MAX,
			DAILY_LIMIT_WINDOW_SECONDS,
		));

	if (!dayOk) {
		return c.json({ error: "Too many requests. Please try again later." }, 429);
	}

	const body = await c.req.json<{
		name?: string;
		email?: string;
		clientId?: string;
		messages?: { role: string; content: string }[];
	}>();
	const { name, email, clientId, messages } = body;

	if (!clientId || typeof clientId !== "string" || clientId.length > 64) {
		return c.json({ error: "Missing or invalid clientId" }, 400);
	}

	const conversationId = await getOrCreateConversation(
		clientId,
		ipAddress,
		c.req.header("User-Agent"),
		name,
		email,
	);

	const t = tables.chatSupportConversation;
	const existing = await db
		.select({ escalatedAt: t.escalatedAt })
		.from(t)
		.where(eq(t.id, conversationId))
		.limit(1);

	if (existing[0]?.escalatedAt) {
		return c.json({ success: true, message: "Already escalated." });
	}

	// Checked only once we know a new escalation will actually be sent, so
	// malformed requests and already-escalated retries don't spend the global
	// cap. Each escalation past this point costs an email and a Discord ping.
	const globalOk = await checkRateLimit(
		"all",
		"escalate_global_day",
		ESCALATE_GLOBAL_DAILY_LIMIT_MAX,
		DAILY_LIMIT_WINDOW_SECONDS,
	);
	if (!globalOk) {
		logger.warn("Chat support global escalation limit reached", {
			ipAddress,
		});
		return c.json({ error: "Too many requests. Please try again later." }, 429);
	}

	await db
		.update(t)
		.set({ escalatedAt: new Date() })
		.where(eq(t.id, conversationId));

	const escapedName = escapeHtml(name ?? "Not provided");
	const escapedEmail = escapeHtml(email ?? "Not provided");
	const escapedConversationId = escapeHtml(conversationId);
	const adminBaseUrl = process.env.ADMIN_URL ?? "https://admin.llmgateway.io";
	const adminConversationUrl = `${adminBaseUrl}/chat-support-logs?chat=${encodeURIComponent(conversationId)}`;
	const escapedAdminConversationUrl = escapeHtml(adminConversationUrl);
	const escapedTranscript = (messages ?? [])
		.map(
			(m) =>
				`${m.role === "user" ? escapeHtml(name ?? "User") : "AI"}: ${escapeHtml(m.content)}`,
		)
		.join("\n\n");

	const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff;">
<table role="presentation" style="width:100%;border-collapse:collapse;">
<tr><td align="center" style="padding:40px 20px;">
<table role="presentation" style="max-width:600px;width:100%;border-collapse:collapse;">
<tr><td style="background-color:#000;padding:30px;text-align:center;border-radius:8px 8px 0 0;">
<h1 style="margin:0;color:#fff;font-size:22px;font-weight:600;">Chat Support Escalation</h1>
</td></tr>
<tr><td style="background-color:#f8f9fa;padding:30px;border-radius:0 0 8px 8px;">
<p style="margin:0 0 15px;font-size:16px;color:#333;"><strong>Name:</strong> ${escapedName}</p>
<p style="margin:0 0 15px;font-size:16px;color:#333;"><strong>Email:</strong> ${escapedEmail}</p>
<p style="margin:0 0 15px;font-size:16px;color:#333;"><strong>Conversation ID:</strong> ${escapedConversationId}</p>
<p style="margin:0 0 15px;font-size:16px;color:#333;"><strong>Admin dashboard:</strong> <a href="${escapedAdminConversationUrl}" style="color:#0066cc;">View conversation</a></p>
<hr style="border:none;border-top:1px solid #e9ecef;margin:20px 0;">
<h2 style="margin:0 0 15px;font-size:16px;color:#333;">Conversation History</h2>
<div style="background:#fff;border:1px solid #e9ecef;border-radius:6px;padding:15px;font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap;">${escapedTranscript}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`.trim();

	const lastUserMessage = [...(messages ?? [])]
		.reverse()
		.find((m) => m.role === "user")?.content;

	await Promise.all([
		sendTransactionalEmail({
			to: replyToEmail,
			subject: `[Chat Support Escalation] ${name ?? "Anonymous"} needs help`,
			html: htmlBody,
		}),
		notifyChatSupportEscalation({
			name,
			email,
			conversationId,
			ipAddress,
			lastMessage: lastUserMessage,
		}),
	]);

	logger.info("Chat support escalated", {
		conversationId,
		name,
		email,
		ipAddress,
	});

	return c.json({ success: true, message: "Escalation sent." });
});
