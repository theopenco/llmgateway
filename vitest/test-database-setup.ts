const defaultTestDatabaseUrl = "postgres://postgres:pw@localhost:5432/test";

process.env.DATABASE_URL ??= defaultTestDatabaseUrl;
process.env.VIDEO_CONTENT_TOKEN_ALLOW_DEV ??= "true";
