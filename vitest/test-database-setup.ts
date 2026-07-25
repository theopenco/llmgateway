const defaultTestDatabaseUrl = "postgres://postgres:pw@localhost:5432/test";

process.env.DATABASE_URL ??= defaultTestDatabaseUrl;
process.env.VIDEO_CONTENT_TOKEN_ALLOW_DEV ??= "true";
// Tests exercise providers against local mock servers (http://localhost:...),
// so relax the provider base URL SSRF guard like a self-hosted deployment.
process.env.ALLOW_INSECURE_PROVIDER_URLS ??= "true";
// Provider keys are encrypted at rest, so writing one needs a master key.
// A fixed throwaway value keeps runs deterministic; crypto specs that assert
// the missing-key behaviour delete it explicitly.
process.env.PROVIDER_KEY_ENCRYPTION_KEY ??=
	Buffer.alloc(32, 7).toString("base64");
