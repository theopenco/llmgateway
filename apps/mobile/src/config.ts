declare const process: {
	env: {
		LOUNGE_API_URL?: string;
		LOUNGE_GATEWAY_URL?: string;
		LOUNGE_WEB_URL?: string;
	};
};

export const config = {
	apiUrl: process.env.LOUNGE_API_URL ?? "https://internal.llmgateway.io",
	gatewayUrl: process.env.LOUNGE_GATEWAY_URL ?? "https://api.llmgateway.io/v1",
	webUrl: process.env.LOUNGE_WEB_URL ?? "https://lounge.llmgateway.io",
};
