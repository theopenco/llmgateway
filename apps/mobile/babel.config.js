module.exports = {
	plugins: [
		[
			"transform-inline-environment-variables",
			{ include: ["LOUNGE_API_URL", "LOUNGE_GATEWAY_URL", "LOUNGE_WEB_URL"] },
		],
		"react-native-worklets/plugin",
	],
	presets: ["module:@react-native/babel-preset"],
};
