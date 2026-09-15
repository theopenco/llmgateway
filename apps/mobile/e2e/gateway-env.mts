import process from "node:process";

import { getProviderEnvConfig } from "@llmgateway/models";

if (!process.env.STACK_SUFFIX || !process.env.GATEWAY_PORT) {
	throw new Error(
		"Load an isolated stack environment before starting the test gateway.",
	);
}

for (const name of Object.keys(process.env)) {
	if (name.startsWith("LLM_")) {
		Reflect.deleteProperty(process.env, name);
	}
}

process.env.LLM_OPENAI_API_KEY = "test-token";
process.env.LLM_OPENAI_BASE_URL = `http://localhost:${Number(process.env.GATEWAY_PORT) + 8}`;
// xAI has no public base-URL env setting; add one only in the isolated harness.
const xai = getProviderEnvConfig("xai");
if (!xai) {
	throw new Error("The xAI test provider is missing.");
}
xai.optional = { ...xai.optional, baseUrl: "LLM_X_AI_BASE_URL" };
process.env.LLM_X_AI_API_KEY = "test-token";
process.env.LLM_X_AI_BASE_URL = process.env.LLM_OPENAI_BASE_URL;
if (process.env.LOUNGE_TEST_VIDEO_SIGNING_KEY) {
	process.env.LLM_VIDEO_CONTENT_JWT_SECRET =
		process.env.LOUNGE_TEST_VIDEO_SIGNING_KEY;
}
process.env.ALLOW_INSECURE_PROVIDER_URLS = "true";
