import { client, queryClient } from "@/api/client";
import {
	escapeReplayFrames,
	escapeRunUrl,
	parseEscapeLink,
	takeEscapeTurn,
	saveEscapeRun,
} from "@/api/escape";
import { ensureGatewayKey } from "@/api/gateway-key";
import { config } from "@/config";

import { applyMove, createGame } from "@llmgateway/shared/sandbox-escape";

jest.mock("@/api/client", () => ({
	client: { POST: jest.fn() },
	queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("@/api/gateway-key", () => ({ ensureGatewayKey: jest.fn() }));
beforeEach(() => jest.resetAllMocks());

test("sends the selected project key, current moves, and cancellation signal to the typed API", async () => {
	jest.mocked(ensureGatewayKey).mockResolvedValue("fixture-project-key");
	jest
		.mocked(client.POST)
		.mockResolvedValue({ data: { move: "down" } } as Awaited<
			ReturnType<typeof client.POST>
		>);
	const body = { projectId: "project", model: "model", levelId: 1, moves: [] };
	const controller = new AbortController();
	await takeEscapeTurn(body, controller.signal);
	expect(ensureGatewayKey).toHaveBeenCalledWith("project");
	expect(client.POST).toHaveBeenCalledWith("/escape/move", {
		body,
		signal: controller.signal,
		headers: { "x-llmgateway-key": "fixture-project-key" },
	});
});

test("canceling while the project key is prepared prevents the generation request", async () => {
	const controller = new AbortController();
	jest.mocked(ensureGatewayKey).mockImplementation(async () => {
		controller.abort();
		return "fixture-project-key";
	});
	await expect(
		takeEscapeTurn(
			{ projectId: "project", model: "model", levelId: 1, moves: [] },
			controller.signal,
		),
	).rejects.toThrow("canceled");
	expect(client.POST).not.toHaveBeenCalled();
});

test("accepts Lounge replay links, including query strings, without following other hosts", () => {
	expect(parseEscapeLink(`${escapeRunUrl("saved-run")}?source=share`)).toBe(
		"saved-run",
	);
	for (const invalid of [
		"not a link",
		"https://evil.example/escape/r/run",
		`${config.webUrl}/share/run`,
		`${config.webUrl}/escape/r/a/b`,
	]) {
		expect(() => parseEscapeLink(invalid)).toThrow("replay link");
	}
});

test("reconstructs every replay frame from the canonical engine without model calls", () => {
	const frames = escapeReplayFrames(1, ["down", "right"]);
	expect(frames).toHaveLength(3);
	expect(frames[0]).toEqual(createGame(1));
	expect(frames[2]).toEqual(
		applyMove(applyMove(createGame(1), "down"), "right"),
	);
	expect(client.POST).not.toHaveBeenCalled();
});

test("rejects corrupt saved moves and unknown levels instead of playing a different run", () => {
	expect(() => escapeReplayFrames(99, [])).toThrow("invalid");
	expect(() => escapeReplayFrames(1, ["teleport"])).toThrow("invalid");
});

test("saving a completed run refreshes history, rankings, and earned points", async () => {
	jest
		.mocked(client.POST)
		.mockResolvedValue({ data: { run: { id: "saved-run" } } } as Awaited<
			ReturnType<typeof client.POST>
		>);
	await saveEscapeRun({ levelId: 1, moves: ["wait"], model: "chosen" });
	expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
		queryKey: ["escape-runs"],
	});
	expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
		queryKey: ["get", "/lounge/points/me"],
	});
	expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
		queryKey: ["get", "/public/escape/leaderboard"],
	});
});
