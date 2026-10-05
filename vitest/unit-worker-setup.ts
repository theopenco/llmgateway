import { testWorkerId, workerDatabaseUrl } from "./test-workers.js";

/**
 * Point this worker at its own clone of the test database and its own Redis
 * logical database, both prepared by vitest/global-setup.ts. Sharing a single
 * database is what forced the unit suite to run one file at a time.
 *
 * Unit tests only: the e2e suite deliberately shares one database so its
 * concurrent cases exercise the same state a deployment would.
 */
const workerId = testWorkerId();
process.env.DATABASE_URL = workerDatabaseUrl(workerId);
// Redis numbers its logical databases from 0, and TEST_WORKER_COUNT is capped
// at the 16 a default Redis provides, so worker ids map onto them one to one.
process.env.REDIS_DB = String(workerId - 1);
process.env.STORAGE_REDIS_DB = String(workerId - 1);
// Postgres allows 100 connections by default, which the app's 20-connection
// pool would exhaust on its own once every worker opens one.
process.env.DATABASE_POOL_MAX ??= "8";
process.env.DATABASE_POOL_MIN ??= "1";
