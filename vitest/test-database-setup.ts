const defaultTestDatabaseUrl = "postgres://postgres:pw@localhost:5432/test";

// TEST_DATABASE_URL takes precedence so a worktree running an isolated stack
// can export DATABASE_URL for its dev database without tests wiping it. CI
// only sets DATABASE_URL (already pointing at the test database), so it keeps
// working unchanged.
process.env.DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	defaultTestDatabaseUrl;
process.env.VIDEO_CONTENT_TOKEN_ALLOW_DEV ??= "true";
// Tests exercise providers against local mock servers (http://localhost:...),
// so relax the provider base URL SSRF guard like a self-hosted deployment.
process.env.ALLOW_INSECURE_PROVIDER_URLS ??= "true";
