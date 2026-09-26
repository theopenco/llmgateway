import { installConsoleCredentialRedaction } from "./redact-credentials.js";
import { resolveTestDatabaseUrl } from "./test-workers.js";

process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.VIDEO_CONTENT_TOKEN_ALLOW_DEV ??= "true";
// Tests exercise providers against local mock servers (http://localhost:...),
// so relax the provider base URL SSRF guard like a self-hosted deployment.
process.env.ALLOW_INSECURE_PROVIDER_URLS ??= "true";

// Both suites can have real provider credentials in the environment (CI e2e
// secrets, a local .env). Keep them out of console output, which vitest copies
// into the blob reports CI uploads as artifacts.
installConsoleCredentialRedaction();
