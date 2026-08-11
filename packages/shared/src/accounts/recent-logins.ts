export interface RecentLogin {
	userId: string;
	email: string;
	name: string;
	image?: string | null;
	lastUsedAt: number;
}

export const RECENT_LOGINS_STORAGE_KEY = "llmgateway_recent_logins";
export const RECENT_LOGINS_CHANGED_EVENT = "llmgateway_recent_logins_changed";

export const MAX_RECENT_LOGINS = 5;
export const RECENT_LOGIN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getStorage(): Storage | null {
	try {
		return typeof globalThis.localStorage === "undefined"
			? null
			: globalThis.localStorage;
	} catch {
		// Safari in private mode throws on property access, not just on write.
		return null;
	}
}

function isRecentLogin(value: unknown): value is RecentLogin {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const entry = value as Partial<RecentLogin>;
	return (
		typeof entry.userId === "string" &&
		entry.userId.length > 0 &&
		typeof entry.email === "string" &&
		typeof entry.name === "string" &&
		typeof entry.lastUsedAt === "number" &&
		Number.isFinite(entry.lastUsedAt)
	);
}

function normalize(entries: RecentLogin[], now: number): RecentLogin[] {
	const seen = new Set<string>();
	return entries
		.filter((entry) => now - entry.lastUsedAt < RECENT_LOGIN_TTL_MS)
		.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
		.filter((entry) => {
			if (seen.has(entry.userId)) {
				return false;
			}
			seen.add(entry.userId);
			return true;
		})
		.slice(0, MAX_RECENT_LOGINS);
}

function write(entries: RecentLogin[]): RecentLogin[] {
	const storage = getStorage();
	if (!storage) {
		return entries;
	}
	try {
		storage.setItem(RECENT_LOGINS_STORAGE_KEY, JSON.stringify(entries));
		notifyRecentLoginsChanged();
	} catch {
		// Quota or private-mode failure. The list is a convenience, so the caller
		// still gets the in-memory value and nothing breaks.
	}
	return entries;
}

/**
 * Same-tab change signal. The native `storage` event only fires in *other*
 * tabs, so writers dispatch this to keep the current tab's hooks in sync.
 */
export function notifyRecentLoginsChanged(): void {
	try {
		if (typeof globalThis.window !== "undefined") {
			globalThis.window.dispatchEvent(new Event(RECENT_LOGINS_CHANGED_EVENT));
		}
	} catch {
		// Non-fatal: the list just won't live-update in this tab.
	}
}

export function readRecentLogins(now: number = Date.now()): RecentLogin[] {
	const storage = getStorage();
	if (!storage) {
		return [];
	}
	try {
		const raw = storage.getItem(RECENT_LOGINS_STORAGE_KEY);
		if (!raw) {
			return [];
		}
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return normalize(parsed.filter(isRecentLogin), now);
	} catch {
		return [];
	}
}

export function recordRecentLogin(
	login: Omit<RecentLogin, "lastUsedAt"> & { lastUsedAt?: number },
	now: number = Date.now(),
): RecentLogin[] {
	const entry: RecentLogin = {
		userId: login.userId,
		email: login.email,
		name: login.name,
		image: login.image ?? null,
		lastUsedAt: login.lastUsedAt ?? now,
	};
	const existing = readRecentLogins(now).filter(
		(candidate) => candidate.userId !== entry.userId,
	);
	return write(normalize([entry, ...existing], now));
}

export function removeRecentLogin(
	userId: string,
	now: number = Date.now(),
): RecentLogin[] {
	return write(
		readRecentLogins(now).filter((entry) => entry.userId !== userId),
	);
}

export function clearRecentLogins(): void {
	const storage = getStorage();
	if (!storage) {
		return;
	}
	try {
		storage.removeItem(RECENT_LOGINS_STORAGE_KEY);
		notifyRecentLoginsChanged();
	} catch {
		// See write(): storage failures are non-fatal here.
	}
}
