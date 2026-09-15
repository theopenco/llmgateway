module.exports = {
	moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
	transformIgnorePatterns: [
		"node_modules/(?!\\.pnpm/|react-native/|@react-native/|react-native-safe-area-context/|@testing-library/|test-renderer/)",
	],
	preset: "@react-native/jest-preset",
	testMatch: ["**/__tests__/**/*.test.[jt]s?(x)"],
};
