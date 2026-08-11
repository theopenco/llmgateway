export {
	clearRecentLogins,
	MAX_RECENT_LOGINS,
	notifyRecentLoginsChanged,
	readRecentLogins,
	RECENT_LOGIN_TTL_MS,
	RECENT_LOGINS_CHANGED_EVENT,
	RECENT_LOGINS_STORAGE_KEY,
	recordRecentLogin,
	removeRecentLogin,
	type RecentLogin,
} from "./recent-logins.js";

export {
	type DeviceAccount,
	type DeviceSession,
	type DeviceSessionClient,
	revokeDeviceSession,
	setActiveDeviceSession,
	useDeviceAccounts,
	type UseDeviceAccountsOptions,
} from "./use-device-accounts.js";

export {
	useLoginAccounts,
	type UseLoginAccountsOptions,
} from "./use-login-accounts.js";

export {
	type RecordableUser,
	useRecordRecentLogin,
} from "./use-record-recent-login.js";
