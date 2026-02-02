import { drizzle } from "drizzle-orm/node-postgres";

import { redisClient } from "@llmgateway/cache";

import { pool } from "./db.js";
import { RedisCache } from "./redis-cache.js";
import { relations } from "./relations.js";

// Use the shared pool from db.ts instead of creating a separate pool
// This prevents connection exhaustion from having multiple pools
export const cdb = drizzle({
	client: pool,
	casing: "snake_case",
	relations,
	cache: new RedisCache(redisClient),
});
