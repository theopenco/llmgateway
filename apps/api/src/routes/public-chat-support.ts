import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { Hono } from "hono";

import { redisClient } from "@/auth/config.js";
import { sendTransactionalEmail } from "@/utils/email.js";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { and, db, eq, inArray, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
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
const CONVERSATION_TTL_SECONDS = 60 * 60; // 1 hour

const DOCS_BASE_URL = "https://docs.llmgateway.io";

const SYSTEM_PROMPT = `You are the LLM Gateway support assistant. You ONLY answer questions related to LLM Gateway — the unified API gateway for multiple LLM providers.

Your knowledge covers:
- Getting started, quick start, and setup
- API endpoints: /v1/chat/completions, /v1/messages, /v1/models, /v1/moderations, /v1/videos
- Features: routing, caching, response healing, vision, image generation, video generation, web search, reasoning, guardrails, audit logs, cost breakdown, data retention, metadata, custom providers, API keys, moderations
- Guides: Cursor, Cline, Claude Code, Codex CLI, OpenCode, Autohand, CLI, MCP, n8n, Agent Skills, OpenClaw
- Integrations: AWS Bedrock, Azure
- Migrations: from OpenRouter, LiteLLM, Vercel AI Gateway
- Learning: dashboard, API keys, playground, billing, activity, usage metrics, model usage, transactions, team, org preferences, preferences, provider keys, referrals, security events, guardrails, audit logs, policies
- Self-hosting
- Rate limits and resources

When answering:
1. Be concise and helpful
2. Include relevant documentation links using this format: ${DOCS_BASE_URL}/<path>
3. Common doc paths:
   - Quick start: ${DOCS_BASE_URL}/quick-start
   - API Chat Completions: ${DOCS_BASE_URL}/v1_chat_completions
   - API Messages (Anthropic): ${DOCS_BASE_URL}/v1_messages
   - Models: ${DOCS_BASE_URL}/v1_models
   - Routing: ${DOCS_BASE_URL}/features/routing
   - Caching: ${DOCS_BASE_URL}/features/caching
   - Image Generation: ${DOCS_BASE_URL}/features/image-generation
   - Video Generation: ${DOCS_BASE_URL}/features/video-generation
   - Vision: ${DOCS_BASE_URL}/features/vision
   - Guardrails: ${DOCS_BASE_URL}/features/guardrails
   - Audit Logs: ${DOCS_BASE_URL}/features/audit-logs
   - Web Search: ${DOCS_BASE_URL}/features/web-search
   - Reasoning: ${DOCS_BASE_URL}/features/reasoning
   - API Keys: ${DOCS_BASE_URL}/features/api-keys
   - Custom Providers: ${DOCS_BASE_URL}/features/custom-providers
   - Self Host: ${DOCS_BASE_URL}/self-host
   - Rate Limits: ${DOCS_BASE_URL}/resources/rate-limits
   - Cursor guide: ${DOCS_BASE_URL}/guides/cursor
   - Claude Code guide: ${DOCS_BASE_URL}/guides/claude-code
   - MCP guide: ${DOCS_BASE_URL}/guides/mcp
   - Billing: ${DOCS_BASE_URL}/learn/billing
   - Dashboard: ${DOCS_BASE_URL}/learn/dashboard
   - Playground: ${DOCS_BASE_URL}/learn/playground
4. If the question is NOT related to LLM Gateway, politely decline and suggest they ask about LLM Gateway features instead.
5. Do not make up features or capabilities. If unsure, direct them to the docs at ${DOCS_BASE_URL} or suggest contacting support at contact@llmgateway.io.
6. Keep responses short — ideally under 200 words.`;

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

async function checkRateLimit(identifier: string): Promise<boolean> {
	const key = `chat_support_rate_limit:${identifier}`;
	try {
		const count = await redisClient.incr(key);
		if (count === 1) {
			await redisClient.expire(key, RATE_LIMIT_WINDOW_SECONDS);
		}
		return count <= RATE_LIMIT_MAX;
	} catch (error) {
		logger.error("Chat support rate limit check failed", { error });
		return true;
	}
}

function getTextFromUIMessage(message: UIMessage): string {
	return message.parts
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join("");
}

async function getOrCreateConversation(
	clientId: string,
	ipAddress: string,
	userAgent: string | undefined,
	name: string | undefined,
	email: string | undefined,
): Promise<string> {
	const redisKey = `chat_support_conv:${clientId}`;
	const existingId = await redisClient.get(redisKey);
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
		.values({ ipAddress, userAgent, name, email, messageCount: 0 })
		.returning({ id: t.id });
	const conversationId = conv!.id;

	const redisKey = `chat_support_conv:${clientId}`;
	await redisClient.set(
		redisKey,
		conversationId,
		"EX",
		CONVERSATION_TTL_SECONDS,
	);
	return conversationId;
}

async function persistMessages(
	conversationId: string,
	messages: UIMessage[],
	assistantContent: string,
	clientId: string,
	ipAddress: string,
	userAgent: string | undefined,
	name: string | undefined,
	email: string | undefined,
): Promise<void> {
	try {
		const t = tables.chatSupportConversation;
		const mt = tables.chatSupportMessage;

		const existingMessages = await db
			.select({ id: mt.id })
			.from(mt)
			.where(
				and(
					eq(mt.conversationId, conversationId),
					inArray(mt.role, ["user", "assistant"]),
				),
			);

		const existingCount = existingMessages.length;

		// User reset the widget — start a new conversation
		if (existingCount > messages.length) {
			const newConvId = await createNewConversation(
				clientId,
				ipAddress,
				userAgent,
				name,
				email,
			);
			const allMessages = messages.map((m, i) => ({
				conversationId: newConvId,
				role: m.role as "user" | "assistant",
				content: getTextFromUIMessage(m),
				sequence: i,
			}));
			allMessages.push({
				conversationId: newConvId,
				role: "assistant" as const,
				content: assistantContent,
				sequence: messages.length,
			});
			await db.insert(mt).values(allMessages);
			await db
				.update(t)
				.set({ messageCount: allMessages.length })
				.where(eq(t.id, newConvId));
			return;
		}

		const newMessages: {
			conversationId: string;
			role: "user" | "assistant";
			content: string;
			sequence: number;
		}[] = [];

		for (let i = existingCount; i < messages.length; i++) {
			const m = messages[i]!;
			newMessages.push({
				conversationId,
				role: m.role as "user" | "assistant",
				content: getTextFromUIMessage(m),
				sequence: i,
			});
		}

		newMessages.push({
			conversationId,
			role: "assistant",
			content: assistantContent,
			sequence: messages.length,
		});

		if (newMessages.length > 0) {
			await db.insert(mt).values(newMessages);
		}

		await db
			.update(t)
			.set({ messageCount: existingCount + newMessages.length })
			.where(eq(t.id, conversationId));
	} catch (error) {
		logger.error("Failed to persist chat support messages", { error });
	}
}

export const publicChatSupport = new Hono<ServerTypes>();

publicChatSupport.post("/", async (c) => {
	const ipAddress = extractClientIP(c) ?? "unknown";
	const canSubmit = await checkRateLimit(ipAddress);

	if (!canSubmit) {
		return c.json(
			{
				error: "Too many messages. Please try again later (max 20 per hour).",
			},
			429,
		);
	}

	const body = await c.req.json<{
		messages: UIMessage[];
		name?: string;
		email?: string;
		clientId?: string;
	}>();
	const { messages, name, email, clientId } = body;

	if (!clientId || typeof clientId !== "string" || clientId.length > 64) {
		return c.json({ error: "Missing or invalid clientId" }, 400);
	}

	if (!messages || !Array.isArray(messages) || messages.length === 0) {
		return c.json({ error: "Missing messages" }, 400);
	}

	// Limit message history to prevent abuse
	if (messages.length > 20) {
		return c.json({ error: "Too many messages in conversation" }, 400);
	}

	const gatewayUrl = process.env.GATEWAY_URL ?? "https://api.llmgateway.io/v1";

	const supportApiKey = process.env.SUPPORT_CHAT_API_KEY;
	if (!supportApiKey) {
		logger.error("SUPPORT_CHAT_API_KEY not configured");
		return c.json({ error: "Chat support is not configured" }, 503);
	}

	const userAgent = c.req.header("User-Agent");
	const conversationId = await getOrCreateConversation(
		clientId,
		ipAddress,
		userAgent,
		name,
		email,
	);

	const llmgateway = createLLMGateway({
		apiKey: supportApiKey,
		baseURL: gatewayUrl,
		headers: {
			"x-source": "support-chat",
		},
	});

	const result = streamText({
		model: llmgateway.chat("auto"),
		system: SYSTEM_PROMPT,
		messages: await convertToModelMessages(messages),
		maxOutputTokens: 1024,
		async onFinish({ text }) {
			await persistMessages(
				conversationId,
				messages,
				text,
				clientId,
				ipAddress,
				userAgent,
				name,
				email,
			);
		},
	});

	return result.toTextStreamResponse();
});

publicChatSupport.post("/escalate", async (c) => {
	const ipAddress = extractClientIP(c) ?? "unknown";
	const canSubmit = await checkRateLimit(ipAddress);

	if (!canSubmit) {
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

	await db
		.update(t)
		.set({ escalatedAt: new Date() })
		.where(eq(t.id, conversationId));

	const escapedName = escapeHtml(name ?? "Not provided");
	const escapedEmail = escapeHtml(email ?? "Not provided");
	const escapedConversationId = escapeHtml(conversationId);
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
<hr style="border:none;border-top:1px solid #e9ecef;margin:20px 0;">
<h2 style="margin:0 0 15px;font-size:16px;color:#333;">Conversation History</h2>
<div style="background:#fff;border:1px solid #e9ecef;border-radius:6px;padding:15px;font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap;">${escapedTranscript}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`.trim();

	await sendTransactionalEmail({
		to: replyToEmail,
		subject: `[Chat Support Escalation] ${name ?? "Anonymous"} needs help`,
		html: htmlBody,
	});

	logger.info("Chat support escalated", {
		conversationId,
		name,
		email,
		ipAddress,
	});

	return c.json({ success: true, message: "Escalation sent." });
});
