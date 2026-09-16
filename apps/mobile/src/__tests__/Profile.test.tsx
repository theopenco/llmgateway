import {
	QueryClient,
	QueryClientProvider,
	useMutation,
} from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";

import { api } from "@/api/client";
import { ProfileProgress } from "@/components/ProfileProgress";
import { PublicProfile } from "@/components/PublicProfile";
import { Leaderboard } from "@/screens/Leaderboard";

import type { PropsWithChildren } from "react";

jest.mock("@/api/client", () => ({
	api: { useQuery: jest.fn(), useMutation: jest.fn() },
}));
jest.useFakeTimers();
const patch = jest.fn();
const reload = jest.fn();
let member = {
	name: "Test Admin",
	username: null as string | null,
	profilePublic: false,
	profileHidePicture: false,
};
const stats = {
	totalPoints: 175,
	todayPoints: 25,
	level: 2,
	levelTitle: "Regular",
	currentLevelAt: 100,
	nextLevelAt: 400,
	rank: 3,
	currentStreak: 2,
	longestStreak: 5,
	activeDays: 7,
	breakdown: [{ kind: "sandbox_escape", points: 175, count: 7 }],
};
let cache: QueryClient;
let invalidate: jest.SpyInstance;
function Wrapper({ children }: PropsWithChildren) {
	return <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
}
beforeEach(() => {
	jest.clearAllMocks();
	cache = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	invalidate = jest.spyOn(cache, "invalidateQueries");
	member = {
		name: "Test Admin",
		username: null,
		profilePublic: false,
		profileHidePicture: false,
	};
	patch.mockImplementation(
		async ({ body }: { body: Partial<typeof member> }) => {
			member = { ...member, ...body };
			return { user: member };
		},
	);
	(api.useQuery as jest.Mock).mockImplementation(
		(_method: string, path: string) => ({
			data:
				path === "/user/me"
					? { user: member }
					: path === "/lounge/points/me"
						? { stats }
						: {
								entries: [
									{
										rank: 1,
										username: "member-one",
										name: "Member One",
										image: null,
										points: 200,
										level: 2,
										levelTitle: "Regular",
									},
									{
										rank: 1,
										username: "member-two",
										name: null,
										image: null,
										points: 200,
										level: 2,
										levelTitle: "Regular",
									},
								],
							},
			refetch: reload,
			isRefetching: false,
		}),
	);
	(api.useMutation as jest.Mock).mockImplementation(
		(_method: string, _path: string, options: object) =>
			useMutation({ mutationFn: patch, ...options }),
	);
});

test("joining requires a valid username and explicit consent, then refreshes privacy and ranks", async () => {
	await render(<PublicProfile onLeaderboard={jest.fn()} />, {
		wrapper: Wrapper,
	});
	const user = userEvent.setup();
	expect(patch).not.toHaveBeenCalled();
	await user.press(
		screen.getByRole("button", { name: "Join the leaderboard" }),
	);
	expect(screen.getByRole("alert")).toHaveTextContent(/Use 3–30 letters/);
	expect(patch).not.toHaveBeenCalled();
	await user.type(screen.getByLabelText("Public username"), " Native-Member ");
	await user.press(
		screen.getByRole("button", { name: "Join the leaderboard" }),
	);
	expect(
		await screen.findByText("Your profile is public as @native-member."),
	).toBeOnTheScreen();
	expect(patch.mock.calls[0][0]).toEqual({
		body: { username: "native-member", profilePublic: true },
	});
	expect(invalidate.mock.calls.map(([options]) => options.queryKey)).toEqual([
		["get", "/user/me"],
		["get", "/lounge/points/me"],
		["get", "/public/lounge-leaderboard"],
	]);
});

test("keeps a rejected username draft and lets the member correct it", async () => {
	patch.mockRejectedValueOnce(new Error("That username is already taken"));
	await render(<PublicProfile onLeaderboard={jest.fn()} />, {
		wrapper: Wrapper,
	});
	const user = userEvent.setup();
	await user.type(screen.getByLabelText("Public username"), "taken-name");
	await user.press(
		screen.getByRole("button", { name: "Join the leaderboard" }),
	);
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"That username is already taken",
	);
	expect(screen.getByLabelText("Public username")).toHaveDisplayValue(
		"taken-name",
	);
	expect(invalidate).not.toHaveBeenCalled();
	await user.clear(screen.getByLabelText("Public username"));
	await user.type(screen.getByLabelText("Public username"), "new-name");
	await user.press(
		screen.getByRole("button", { name: "Join the leaderboard" }),
	);
	expect(
		await screen.findByText("Your profile is public as @new-name."),
	).toBeOnTheScreen();
	expect(screen.queryByRole("alert")).not.toBeOnTheScreen();
});

test("hides the picture, leaves the leaderboard, and rejoins with the existing username", async () => {
	member = { ...member, username: "returning-member", profilePublic: true };
	await render(<PublicProfile onLeaderboard={jest.fn()} />, {
		wrapper: Wrapper,
	});
	const user = userEvent.setup();
	await fireEvent(
		screen.getByRole("switch", { name: "Hide my profile picture" }),
		"valueChange",
		true,
	);
	await waitFor(() =>
		expect(
			screen.getByRole("switch", { name: "Hide my profile picture" }),
		).toHaveProp("value", true),
	);
	expect(patch.mock.calls[0][0]).toEqual({
		body: { profileHidePicture: true },
	});
	await user.press(
		screen.getByRole("button", { name: "Make profile private" }),
	);
	expect(await screen.findByText("Your profile is private.")).toBeOnTheScreen();
	expect(patch.mock.calls[1][0]).toEqual({ body: { profilePublic: false } });
	expect(screen.queryByLabelText("Public username")).not.toBeOnTheScreen();
	await user.press(
		screen.getByRole("button", { name: "Join the leaderboard" }),
	);
	expect(
		await screen.findByText("Your profile is public as @returning-member."),
	).toBeOnTheScreen();
	expect(patch.mock.calls[2][0]).toEqual({ body: { profilePublic: true } });
});

test("reports failed privacy changes without claiming the profile became private", async () => {
	member = { ...member, username: "public-member", profilePublic: true };
	patch.mockRejectedValueOnce(new Error("Network unavailable"));
	await render(<PublicProfile onLeaderboard={jest.fn()} />, {
		wrapper: Wrapper,
	});
	await userEvent
		.setup()
		.press(screen.getByRole("button", { name: "Make profile private" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Network unavailable",
	);
	expect(
		screen.getByText("Your profile is public as @public-member."),
	).toBeOnTheScreen();
	expect(invalidate).not.toHaveBeenCalled();
});

test("shows progress within the current level and activity/streak details", async () => {
	await render(<ProfileProgress />, { wrapper: Wrapper });
	expect(
		screen.getByRole("progressbar", { name: "Progress to next level" }),
	).toHaveAccessibilityValue({ now: 25, min: 0, max: 100 });
	expect(screen.getByLabelText("Today: +25 points")).toBeOnTheScreen();
	expect(screen.getByLabelText("Global rank: #3")).toBeOnTheScreen();
	expect(screen.getByLabelText("Longest streak: 5 days")).toBeOnTheScreen();
	expect(screen.getByText("225 points to level 3")).toBeOnTheScreen();
	expect(screen.getByText("Sandbox escapes")).toBeOnTheScreen();
	expect(screen.getByText("7 activities · 175 points")).toBeOnTheScreen();
});

test("preserves server tie ranks and requests the full web leaderboard", async () => {
	await render(<Leaderboard />, { wrapper: Wrapper });
	expect(screen.getByText("#1 · Member One")).toBeOnTheScreen();
	expect(screen.getByText("#1 · member-two")).toBeOnTheScreen();
	expect(api.useQuery).toHaveBeenCalledWith(
		"get",
		"/public/lounge-leaderboard",
		{ params: { query: { limit: 100 } } },
		{ refetchOnMount: "always" },
	);
});

test("an unavailable leaderboard shows a retry instead of an empty ranking", async () => {
	(api.useQuery as jest.Mock).mockReturnValue({
		isError: true,
		error: new Error("Offline"),
		refetch: reload,
		isRefetching: false,
	});
	await render(<Leaderboard />, { wrapper: Wrapper });
	expect(screen.getByRole("alert")).toHaveTextContent("Offline");
	expect(
		screen.queryByText("No public members have earned points yet."),
	).not.toBeOnTheScreen();
	await userEvent
		.setup()
		.press(screen.getByRole("button", { name: "Retry loading leaderboard" }));
	expect(reload).toHaveBeenCalledTimes(3);
});
