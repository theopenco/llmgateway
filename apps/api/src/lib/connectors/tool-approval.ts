import { isDeepStrictEqual } from "node:util";

import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { and, db, eq, tables } from "@llmgateway/db";

const partsSchema = z.array(z.record(z.unknown()));
const approvalPartSchema = z
	.object({
		type: z.string(),
		toolName: z.string().optional(),
		toolCallId: z.string(),
		state: z.string(),
		input: z.unknown().optional(),
		approval: z
			.object({ signature: z.string().optional() })
			.passthrough()
			.optional(),
	})
	.passthrough();
const uncertainOutcome =
	"The result could not be confirmed. Check the connected app before asking to run this action again.";

export async function executePersistedToolApproval({
	userId,
	messageId,
	toolCallId,
	connectorId,
	toolName,
	input,
	approved,
	execute,
}: {
	userId: string;
	messageId: string;
	toolCallId: string;
	connectorId: string;
	toolName: string;
	input: Record<string, unknown>;
	approved: boolean;
	execute: () => Promise<unknown>;
}) {
	const [message] = await db
		.select({ tools: tables.message.tools, metadata: tables.message.metadata })
		.from(tables.message)
		.innerJoin(tables.chat, eq(tables.message.chatId, tables.chat.id))
		.where(
			and(
				eq(tables.message.id, messageId),
				eq(tables.message.role, "assistant"),
				eq(tables.chat.userId, userId),
				eq(tables.chat.status, "active"),
			),
		);
	if (!message?.tools) {
		throw new HTTPException(404, { message: "Tool request not found" });
	}
	const parts = partsSchema.parse(JSON.parse(message.tools));
	const parsedPart = approvalPartSchema.safeParse(
		parts.find((candidate) => candidate.toolCallId === toolCallId),
	);
	const part = parsedPart.success ? parsedPart.data : undefined;
	if (!part || part.state !== "approval-requested") {
		throw new HTTPException(409, {
			message:
				"This tool request has already been answered. Reload the conversation.",
		});
	}
	const expectedName = `${connectorId.replaceAll("-", "_")}__${toolName}`;
	if (
		(part.toolName ?? part.type.slice(5)) !== expectedName ||
		!isDeepStrictEqual(part.input, input) ||
		(approved && !part.approval?.signature)
	) {
		throw new HTTPException(400, {
			message: "The tool request does not match the saved approval",
		});
	}
	const claimedParts = parts.map((candidate) =>
		candidate.toolCallId === toolCallId
			? {
					...candidate,
					state: approved ? "output-error" : "output-denied",
					approval: { ...part.approval, approved },
					...(approved ? { errorText: uncertainOutcome } : {}),
				}
			: candidate,
	);
	const claimed = JSON.stringify(claimedParts);
	const [updated] = await db
		.update(tables.message)
		.set({
			tools: claimed,
			metadata: { ...message.metadata, toolContinuation: true },
		})
		.where(
			and(
				eq(tables.message.id, messageId),
				eq(tables.message.tools, message.tools),
			),
		)
		.returning({ id: tables.message.id });
	if (!updated) {
		throw new HTTPException(409, {
			message:
				"This tool request has already been answered. Reload the conversation.",
		});
	}
	const output = approved ? await execute() : null;
	return await db.transaction(async (tx) => {
		const [current] = await tx
			.select()
			.from(tables.message)
			.where(eq(tables.message.id, messageId))
			.for("update");
		if (!current?.tools) {
			throw new HTTPException(409, {
				message: "The conversation changed while the tool was running",
			});
		}
		const completed = partsSchema
			.parse(JSON.parse(current.tools))
			.map((candidate) => {
				if (candidate.toolCallId !== toolCallId) {
					return candidate;
				}
				const next: Record<string, unknown> = {
					...candidate,
					state: approved ? "output-available" : "output-denied",
					...(approved ? { output } : {}),
				};
				delete next.errorText;
				return next;
			});
		const tools = JSON.stringify(completed);
		await tx
			.update(tables.message)
			.set({ tools, metadata: { ...current.metadata, toolContinuation: true } })
			.where(eq(tables.message.id, messageId));
		return { result: JSON.stringify(output), tools };
	});
}

export function preserveAnsweredToolCalls(
	existing: string | null,
	incoming: string | null | undefined,
) {
	if (!existing || incoming === undefined) {
		return incoming;
	}
	const previous = partsSchema.parse(JSON.parse(existing));
	const next = incoming ? partsSchema.parse(JSON.parse(incoming)) : [];
	for (const part of previous) {
		if (
			typeof part.toolCallId !== "string" ||
			!["output-available", "output-error", "output-denied"].includes(
				String(part.state),
			)
		) {
			continue;
		}
		const index = next.findIndex(
			(candidate) => candidate.toolCallId === part.toolCallId,
		);
		if (index === -1) {
			next.push(part);
		} else {
			next[index] = part;
		}
	}
	return JSON.stringify(next);
}
