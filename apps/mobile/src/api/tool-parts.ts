import { z } from "zod";

import { client } from "@/api/client";

import {
	loungeConnectorIds,
	loungeConnectors,
} from "@llmgateway/shared/lounge-connectors";

const toolSchema = z
	.object({
		type: z.literal("dynamic-tool"),
		toolName: z.string().min(1),
		toolCallId: z.string().min(1),
		state: z.enum([
			"input-streaming",
			"input-available",
			"approval-requested",
			"approval-responded",
			"output-available",
			"output-error",
			"output-denied",
		]),
		input: z.unknown(),
		output: z.unknown().optional(),
		errorText: z.string().optional(),
		approval: z
			.object({
				id: z.string(),
				signature: z.string().optional(),
				approved: z.boolean().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();
export type ToolPart = z.infer<typeof toolSchema>;

export function readToolParts(raw?: string | null): ToolPart[] {
	try {
		if (!raw) {
			return [];
		}
		return z
			.array(z.record(z.unknown()))
			.parse(JSON.parse(raw))
			.map((stored) => {
				if (
					stored.type !== "dynamic-tool" &&
					!(typeof stored.type === "string" && stored.type.startsWith("tool-"))
				) {
					throw new Error("Invalid tool part");
				}
				const part = toolSchema.parse({
					...stored,
					type: "dynamic-tool",
					toolName:
						typeof stored.type === "string" && stored.type.startsWith("tool-")
							? stored.type.slice(5)
							: stored.toolName,
				});
				if (part.state === "approval-responded") {
					return toolOutcome(
						part,
						part.approval?.approved === true,
						undefined,
						part.approval?.approved ? uncertainToolOutcome : undefined,
					);
				}
				if (
					part.state === "input-streaming" ||
					part.state === "input-available"
				) {
					return {
						...part,
						state: "output-error" as const,
						approval: undefined,
						errorText:
							"This request was interrupted before approval. Ask again to create a new request.",
					};
				}
				return part;
			});
	} catch (cause) {
		throw new Error(
			"Saved tool requests could not be read. Please reload this conversation.",
			{ cause },
		);
	}
}

export function pendingTool(part: ToolPart) {
	return part.state === "approval-requested";
}
export function toolTarget(part: ToolPart) {
	const connectorId = loungeConnectorIds.find((id) =>
		part.toolName.startsWith(`${id.replaceAll("-", "_")}__`),
	);
	if (!connectorId) {
		throw new Error("This tool is not a supported connector.");
	}
	return {
		connectorId,
		toolName: part.toolName.slice(connectorId.replaceAll("-", "_").length + 2),
	};
}
export function toolLabel(part: ToolPart) {
	const connectorId = loungeConnectorIds.find((id) =>
		part.toolName.startsWith(`${id.replaceAll("-", "_")}__`),
	);
	return connectorId
		? `${loungeConnectors[connectorId].name}: ${part.toolName.split("__").slice(1).join("__").replaceAll("_", " ")}`
		: part.toolName;
}

export function toolOutcome(
	part: ToolPart,
	approved: boolean,
	output?: unknown,
	errorText?: string,
): ToolPart {
	const rest = { ...part };
	delete rest.output;
	delete rest.errorText;
	return {
		...rest,
		state: approved
			? errorText
				? "output-error"
				: "output-available"
			: "output-denied",
		...(part.approval && { approval: { ...part.approval, approved } }),
		...(approved && (errorText ? { errorText } : { output })),
	};
}
export const uncertainToolOutcome =
	"The result could not be confirmed. Check the connected app before asking to run this action again.";

export async function answerToolCall({
	parts,
	toolCallId,
	approved,
	persist,
	signal,
}: {
	parts: ToolPart[];
	toolCallId: string;
	approved: boolean;
	persist: (parts: ToolPart[]) => Promise<void>;
	signal: AbortSignal;
}): Promise<ToolPart[]> {
	const part = parts.find((item) => item.toolCallId === toolCallId);
	if (!part || !pendingTool(part)) {
		throw new Error(
			"This request has already been answered. Reload the conversation.",
		);
	}
	const replace = (value: ToolPart) =>
		parts.map((item) => (item.toolCallId === toolCallId ? value : item));
	if (!approved) {
		const denied = replace(toolOutcome(part, false));
		await persist(denied);
		return denied;
	}
	if (!part.approval?.signature) {
		throw new Error(
			"This request is no longer valid. Decline it and ask again.",
		);
	}
	const target = toolTarget(part);
	const input = z.record(z.unknown()).parse(part.input);
	signal.throwIfAborted();
	// A crash must not leave an executable approval behind in shared history.
	await persist(
		replace(toolOutcome(part, true, undefined, uncertainToolOutcome)),
	);
	signal.throwIfAborted();
	try {
		const result = await client.POST(
			"/connectors/{connectorId}/tools/{toolName}",
			{ params: { path: target }, body: { input }, signal },
		);
		if (!result.data) {
			throw new Error("The connector did not return a result.");
		}
		const output: unknown = JSON.parse(result.data.result);
		const completed = replace(toolOutcome(part, true, output));
		await persist(completed);
		return completed;
	} catch (cause) {
		throw new Error(uncertainToolOutcome, { cause });
	}
}
