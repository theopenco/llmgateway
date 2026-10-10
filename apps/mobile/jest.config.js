module.exports = {
	setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
	moduleNameMapper: {
		"^react$": "<rootDir>/node_modules/react",
		"^react/(.*)$": "<rootDir>/node_modules/react/$1",
		"^react-native$": "<rootDir>/node_modules/react-native",
		"^react-native/(Libraries|src)/(.*)$":
			"<rootDir>/node_modules/react-native/$1/$2",
		"^@/(.*)$": "<rootDir>/src/$1",
		"^react-native-enriched-markdown$": "react-native-enriched-markdown/jest",
	},
	transformIgnorePatterns: [
		"node_modules/(?!\\.pnpm/|react-native/|@react-native/|react-native-safe-area-context/|react-native-enriched-markdown/|@testing-library/|test-renderer/)",
	],
	preset: "@react-native/jest-preset",
	testMatch: ["**/__tests__/**/*.test.[jt]s?(x)"],
};
