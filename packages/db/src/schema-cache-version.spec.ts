import { pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
	computeSchemaCacheVersion,
	SCHEMA_CACHE_VERSION,
} from "./schema-cache-version.js";

const base = {
	widget: pgTable("widget", {
		id: text("id").primaryKey(),
		status: text("status"),
	}),
};

describe("schema cache version", () => {
	it("is stable for an unchanged layout", () => {
		expect(computeSchemaCacheVersion(base)).toBe(
			computeSchemaCacheVersion({ ...base }),
		);
	});

	it("ignores non-table exports", () => {
		expect(
			computeSchemaCacheVersion({ ...base, helper: () => null, LIMIT: 5 }),
		).toBe(computeSchemaCacheVersion(base));
	});

	it("changes when a column is added", () => {
		const added = {
			widget: pgTable("widget", {
				id: text("id").primaryKey(),
				status: text("status"),
				kind: text("kind"),
			}),
		};
		expect(computeSchemaCacheVersion(added)).not.toBe(
			computeSchemaCacheVersion(base),
		);
	});

	it("changes when columns are reordered, since cached rows are positional", () => {
		const reordered = {
			widget: pgTable("widget", {
				status: text("status"),
				id: text("id").primaryKey(),
			}),
		};
		expect(computeSchemaCacheVersion(reordered)).not.toBe(
			computeSchemaCacheVersion(base),
		);
	});

	it("changes when a column type changes", () => {
		const retyped = {
			widget: pgTable("widget", {
				id: text("id").primaryKey(),
				status: text("status").array(),
			}),
		};
		expect(computeSchemaCacheVersion(retyped)).not.toBe(
			computeSchemaCacheVersion(base),
		);
	});

	it("exposes a short hex version for the real schema", () => {
		expect(SCHEMA_CACHE_VERSION).toMatch(/^[0-9a-f]{16}$/);
	});
});
