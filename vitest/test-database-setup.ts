const defaultTestDatabaseUrl = "postgres://postgres:pw@localhost:5432/test";

process.env.DATABASE_URL ??= defaultTestDatabaseUrl;
