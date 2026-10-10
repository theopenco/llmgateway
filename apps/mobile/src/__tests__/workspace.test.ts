import * as Keychain from "react-native-keychain";

import { client, queryClient } from "@/api/client";
import { ApiError } from "@/api/errors";
import {
	clearWorkspace,
	restoreWorkspace,
	selectWorkspace,
} from "@/lib/workspace";

jest.mock("@/api/client", () => ({
	...jest.requireActual("@/api/client"),
	client: { GET: jest.fn() },
}));
jest.mock("react-native-keychain", () => ({
	getGenericPassword: jest.fn(),
	setGenericPassword: jest.fn(),
	resetGenericPassword: jest.fn(),
	ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WhenUnlockedThisDeviceOnly" },
	STORAGE_TYPE: { AES_GCM_NO_AUTH: "AES_GCM_NO_AUTH" },
}));
const get = client.GET as jest.Mock<
	Promise<unknown>,
	[string, { params?: { path?: { id: string } } }?]
>;
const service = "io.llmgateway.lounge.workspace";
const storedResult = {
	service,
	storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
};
let saved: string | undefined;
let projects: { id: string; status: string }[];
beforeEach(() => {
	jest.restoreAllMocks();
	jest.resetAllMocks();
	queryClient.clear();
	jest.spyOn(queryClient, "setQueryData");
	saved = undefined;
	projects = [
		{ id: "project", status: "active" },
		{ id: "second", status: "active" },
	];
	jest
		.mocked(Keychain.getGenericPassword)
		.mockImplementation(async () =>
			saved
				? { ...storedResult, username: "workspace", password: saved }
				: false,
		);
	jest
		.mocked(Keychain.setGenericPassword)
		.mockImplementation(async (_user, password) => {
			saved = password;
			return storedResult;
		});
	jest.mocked(Keychain.resetGenericPassword).mockImplementation(async () => {
		saved = undefined;
		return true;
	});
	get.mockImplementation(async (path) => ({
		response: new Response(),
		data:
			path === "/playground/chat-org"
				? { organizationId: "personal", projectId: "project" }
				: path === "/orgs"
					? {
							organizations: [
								{ id: "personal", kind: "chat", name: "Default" },
								{
									id: "organization",
									kind: "default",
									name: "Test Organization",
								},
							],
						}
					: { projects },
	}));
});
afterEach(() => queryClient.clear());

test("a late restoration cannot replace a newly selected workspace", async () => {
	let finishRestore: (value: unknown) => void = () => {
		throw new Error("Restore not started");
	};
	const previous = queryClient.fetchQuery({
		queryKey: ["native-workspace"],
		queryFn: () =>
			new Promise((resolve) => {
				finishRestore = resolve;
			}),
	});
	const cancelled = expect(previous).rejects.toThrow();
	await selectWorkspace("organization");
	finishRestore({
		organizationId: "personal",
		projectId: "project",
		name: "Personal Lounge",
	});
	await cancelled;
	expect(queryClient.getQueryData(["native-workspace"])).toMatchObject({
		organizationId: "organization",
	});
});

test("new installations resolve the personal workspace and its active project", async () => {
	expect(await restoreWorkspace()).toEqual({
		organizationId: "personal",
		projectId: "project",
		name: "Personal Lounge",
	});
	expect(get).toHaveBeenCalledWith("/playground/chat-org", {
		signal: undefined,
	});
});

test("selection survives a fresh restore without consulting the personal default", async () => {
	await selectWorkspace("organization");
	expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
		"workspace",
		JSON.stringify({ organizationId: "organization", projectId: "project" }),
		{ service, accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
	);
	get.mockClear();
	expect(await restoreWorkspace()).toEqual({
		organizationId: "organization",
		projectId: "project",
		name: "Test Organization",
	});
	expect(get).not.toHaveBeenCalledWith(
		"/playground/chat-org",
		expect.anything(),
	);
});

test("restores the exact saved project instead of choosing the first available one", async () => {
	saved = JSON.stringify({
		organizationId: "organization",
		projectId: "second",
	});
	expect(await restoreWorkspace()).toMatchObject({ projectId: "second" });
});

test.each(["missing", "inactive"])(
	"does not switch billing when the saved project is %s",
	async (state) => {
		saved = JSON.stringify({
			organizationId: "organization",
			projectId: "project",
		});
		projects =
			state === "missing"
				? [{ id: "second", status: "active" }]
				: [
						{ id: "project", status: "inactive" },
						{ id: "second", status: "active" },
					];
		await expect(restoreWorkspace()).rejects.toThrow("no longer available");
		expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
		expect(get).not.toHaveBeenCalledWith(
			"/playground/chat-org",
			expect.anything(),
		);
	},
);

test.each([403, 404, 503])(
	"keeps the saved choice when restoration returns %s",
	async (status) => {
		saved = JSON.stringify({
			organizationId: "organization",
			projectId: "project",
		});
		get.mockRejectedValue(new ApiError("Service unavailable", status));
		await expect(restoreWorkspace()).rejects.toThrow(
			status === 503 ? "Service unavailable" : "no longer available",
		);
		expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
		expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
	},
);

test("requires another explicit choice if organization membership is gone", async () => {
	saved = JSON.stringify({ organizationId: "removed", projectId: "project" });
	await expect(restoreWorkspace()).rejects.toThrow("no longer available");
	expect(get).toHaveBeenCalledTimes(1);
});

test("corrupt storage does not silently select a billing workspace", async () => {
	saved = "invalid";
	await expect(restoreWorkspace()).rejects.toThrow("could not be read");
	expect(get).not.toHaveBeenCalled();
});

test.each([false, "throw"])(
	"does not activate an unsaved selection when storage returns %s",
	async (failure) => {
		if (failure === false) {
			jest.mocked(Keychain.setGenericPassword).mockResolvedValue(false);
		} else {
			jest
				.mocked(Keychain.setGenericPassword)
				.mockRejectedValue(new Error("Keychain unavailable"));
		}
		await expect(selectWorkspace("organization")).rejects.toThrow();
		expect(queryClient.setQueryData).not.toHaveBeenCalled();
	},
);

test("sign-out clears an in-flight storage write before a new session can restore it", async () => {
	let finishWrite: () => void = () => {
		throw new Error("Write not started");
	};
	let writeStarted: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		writeStarted = resolve;
	});
	jest
		.mocked(Keychain.setGenericPassword)
		.mockImplementation(async (_user, password) => {
			writeStarted();
			await new Promise<void>((resolve) => {
				finishWrite = resolve;
			});
			saved = password;
			return storedResult;
		});
	const selection = selectWorkspace("organization");
	const rejected = expect(selection).rejects.toThrow("session changed");
	await started;
	const clearing = clearWorkspace();
	finishWrite();
	await rejected;
	await clearing;
	expect(saved).toBeUndefined();
	expect(queryClient.setQueryData).not.toHaveBeenCalled();
	expect(await restoreWorkspace()).toMatchObject({
		organizationId: "personal",
	});
});
