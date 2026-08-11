import { beforeEach, describe, expect, it } from "vitest";

import {
	MAX_RECENT_LOGINS,
	readRecentLogins,
	RECENT_LOGIN_TTL_MS,
	RECENT_LOGINS_STORAGE_KEY,
	recordRecentLogin,
	removeRecentLogin,
} from "./recent-logins.js";

class MemoryStorage implements Storage {
	private store = new Map<string, string>();

	public get length() {
		return this.store.size;
	}

	public clear() {
		this.store.clear();
	}

	public getItem(key: string) {
		return this.store.get(key) ?? null;
	}

	public key(index: number) {
		return Array.from(this.store.keys())[index] ?? null;
	}

	public removeItem(key: string) {
		this.store.delete(key);
	}

	public setItem(key: string, value: string) {
		this.store.set(key, value);
	}
}

const NOW = 1_800_000_000_000;

function seed(value: unknown) {
	storage.setItem(RECENT_LOGINS_STORAGE_KEY, JSON.stringify(value));
}

function entry(userId: string, lastUsedAt: number) {
	return {
		userId,
		email: `${userId}@example.com`,
		name: userId,
		image: null,
		lastUsedAt,
	};
}

let storage: MemoryStorage;

beforeEach(() => {
	storage = new MemoryStorage();
	Object.defineProperty(globalThis, "localStorage", {
		value: storage,
		configurable: true,
		writable: true,
	});
});

describe("readRecentLogins", () => {
	it("returns an empty list when nothing is stored", () => {
		expect(readRecentLogins(NOW)).toEqual([]);
	});

	it("returns an empty list for corrupt JSON", () => {
		storage.setItem(RECENT_LOGINS_STORAGE_KEY, "{not json");
		expect(readRecentLogins(NOW)).toEqual([]);
	});

	it("returns an empty list when the stored value is not an array", () => {
		seed({ userId: "a" });
		expect(readRecentLogins(NOW)).toEqual([]);
	});

	it("drops malformed entries but keeps valid siblings", () => {
		seed([entry("alice", NOW), { userId: "bob" }, null, "nope"]);
		expect(readRecentLogins(NOW).map((e) => e.userId)).toEqual(["alice"]);
	});

	it("sorts most recently used first", () => {
		seed([entry("alice", NOW - 5_000), entry("bob", NOW - 1_000)]);
		expect(readRecentLogins(NOW).map((e) => e.userId)).toEqual([
			"bob",
			"alice",
		]);
	});

	it("prunes entries older than the TTL", () => {
		seed([
			entry("fresh", NOW - RECENT_LOGIN_TTL_MS + 1_000),
			entry("stale", NOW - RECENT_LOGIN_TTL_MS - 1_000),
		]);
		expect(readRecentLogins(NOW).map((e) => e.userId)).toEqual(["fresh"]);
	});
});

describe("recordRecentLogin", () => {
	it("adds an entry and stamps lastUsedAt", () => {
		const result = recordRecentLogin(
			{ userId: "alice", email: "alice@example.com", name: "Alice" },
			NOW,
		);
		expect(result).toEqual([
			{
				userId: "alice",
				email: "alice@example.com",
				name: "Alice",
				image: null,
				lastUsedAt: NOW,
			},
		]);
		expect(readRecentLogins(NOW)).toEqual(result);
	});

	it("dedupes by userId and refreshes the existing entry", () => {
		recordRecentLogin(
			{ userId: "alice", email: "old@example.com", name: "Old" },
			NOW - 10_000,
		);
		recordRecentLogin(
			{ userId: "alice", email: "new@example.com", name: "New" },
			NOW,
		);

		const stored = readRecentLogins(NOW);
		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({
			userId: "alice",
			email: "new@example.com",
			name: "New",
			lastUsedAt: NOW,
		});
	});

	it("moves a re-used account back to the front", () => {
		recordRecentLogin(
			{ userId: "alice", email: "alice@example.com", name: "Alice" },
			NOW - 10_000,
		);
		recordRecentLogin(
			{ userId: "bob", email: "bob@example.com", name: "Bob" },
			NOW - 5_000,
		);
		recordRecentLogin(
			{ userId: "alice", email: "alice@example.com", name: "Alice" },
			NOW,
		);

		expect(readRecentLogins(NOW).map((e) => e.userId)).toEqual([
			"alice",
			"bob",
		]);
	});

	it("caps the list and evicts the least recently used", () => {
		for (let index = 0; index <= MAX_RECENT_LOGINS; index++) {
			const ageMs = (MAX_RECENT_LOGINS - index) * 1000;
			recordRecentLogin(
				{
					userId: `user-${index}`,
					email: `user-${index}@example.com`,
					name: `User ${index}`,
				},
				NOW - ageMs,
			);
		}

		const stored = readRecentLogins(NOW);
		expect(stored).toHaveLength(MAX_RECENT_LOGINS);
		expect(stored.map((e) => e.userId)).not.toContain("user-0");
		expect(stored[0].userId).toBe(`user-${MAX_RECENT_LOGINS}`);
	});
});

describe("removeRecentLogin", () => {
	it("removes only the named account", () => {
		recordRecentLogin(
			{ userId: "alice", email: "alice@example.com", name: "Alice" },
			NOW,
		);
		recordRecentLogin(
			{ userId: "bob", email: "bob@example.com", name: "Bob" },
			NOW,
		);

		expect(removeRecentLogin("alice", NOW).map((e) => e.userId)).toEqual([
			"bob",
		]);
		expect(readRecentLogins(NOW).map((e) => e.userId)).toEqual(["bob"]);
	});
});

describe("without localStorage", () => {
	it("degrades to an empty list instead of throwing", () => {
		Object.defineProperty(globalThis, "localStorage", {
			value: undefined,
			configurable: true,
			writable: true,
		});

		expect(readRecentLogins(NOW)).toEqual([]);
		expect(() =>
			recordRecentLogin(
				{ userId: "alice", email: "alice@example.com", name: "Alice" },
				NOW,
			),
		).not.toThrow();
	});
});
