import { client, queryClient } from "@/api/client";
import { ensureGatewayKey } from "@/api/gateway-key";
import { config } from "@/config";

import {
	applyMove,
	createGame,
	isDirection,
	isValidLevelId,
} from "@llmgateway/shared/sandbox-escape";

import type { paths } from "@/lib/api/v1";
import type { Direction } from "@llmgateway/shared/sandbox-escape";

type Response<
	P extends keyof paths,
	M extends keyof paths[P],
> = paths[P][M] extends {
	responses: { 200: { content: { "application/json": infer T } } };
}
	? T
	: never;
export type EscapeTurn = Response<"/escape/move", "post">;
export type SavedEscapeRun = Response<"/escape/runs", "post">["run"];
export type EscapeRunBody = NonNullable<
	paths["/escape/runs"]["post"]["requestBody"]
>["content"]["application/json"];

export async function takeEscapeTurn(
	body: {
		projectId: string;
		levelId: number;
		moves: Direction[];
		model: string;
	},
	signal: AbortSignal,
) {
	const key = await ensureGatewayKey(body.projectId);
	if (signal.aborted) {
		throw new Error("Turn canceled.");
	}
	const { data } = await client.POST("/escape/move", {
		body,
		signal,
		headers: { "x-llmgateway-key": key },
	});
	if (!data) {
		throw new Error("The model did not return a turn.");
	}
	return data;
}

export async function saveEscapeRun(body: EscapeRunBody) {
	const { data } = await client.POST("/escape/runs", { body });
	if (!data) {
		throw new Error("Could not save this run. Try again.");
	}
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: ["escape-runs"] }),
		queryClient.invalidateQueries({ queryKey: ["get", "/lounge/points/me"] }),
		queryClient.invalidateQueries({
			queryKey: ["get", "/public/lounge-leaderboard"],
		}),
		queryClient.invalidateQueries({
			queryKey: ["get", "/public/escape/leaderboard"],
		}),
	]);
	return data.run;
}

export function escapeRunUrl(id: string) {
	return `${config.webUrl}/escape/r/${encodeURIComponent(id)}`;
}
export function parseEscapeLink(value: string) {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error("Paste a Lounge Escape replay link.");
	}
	const match = url.pathname.match(/^\/escape\/r\/([a-zA-Z0-9_-]+)\/?$/);
	if (url.origin !== new URL(config.webUrl).origin || !match) {
		throw new Error("Paste a Lounge Escape replay link.");
	}
	return match[1];
}
export function escapeReplayFrames(levelId: number, moves: string[]) {
	if (!isValidLevelId(levelId) || !moves.every(isDirection)) {
		throw new Error("This replay contains an invalid level or move.");
	}
	const frames = [createGame(levelId)];
	for (const move of moves) {
		frames.push(applyMove(frames[frames.length - 1], move));
	}
	return frames;
}
