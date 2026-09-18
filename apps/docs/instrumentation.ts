import { assertClientIpHeaderConfigured } from "@llmgateway/shared/client-ip";

// Refuse to boot without a named client IP header. Server-rendered pages and
// route handlers forward it so the API can bucket visitors individually; a
// deployment that has not set it would silently lump every visitor together.
//
// Next keeps the process alive when the hook throws — it logs an
// unhandledRejection and leaves the port bound serving errors — so exit
// explicitly rather than letting a half-started server look healthy.
export function register() {
	if (process.env.NEXT_RUNTIME !== "nodejs") {
		return;
	}
	try {
		assertClientIpHeaderConfigured();
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exit(1);
	}
}
