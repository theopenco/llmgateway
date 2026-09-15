import process from "node:process";

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
process.env.ALLOW_INSECURE_PROVIDER_URLS = "true";
