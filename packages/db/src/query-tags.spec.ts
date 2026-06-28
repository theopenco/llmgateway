import { afterEach, describe, expect, it, vi } from "vitest";

import {
	getQueryTagComment,
	patchClientQuery,
	setQueryTags,
} from "./query-tags.js";

import type { PoolClient } from "pg";

afterEach(() => {
	// Reset to the untagged state so tests don't leak into each other.
	setQueryTags({});
});

describe("setQueryTags / getQueryTagComment", () => {
	it("produces a sqlcommenter comment", () => {
		setQueryTags({ application: "gateway" });
		expect(getQueryTagComment()).toBe("/*application='gateway'*/");
	});

	it("sorts keys and drops empty values", () => {
		setQueryTags({ route: "/v1/chat", application: "api", controller: "" });
		expect(getQueryTagComment()).toBe(
			"/*application='api',route='%2Fv1%2Fchat'*/",
		);
	});

	it("url-encodes keys and values", () => {
		setQueryTags({ application: "my app's worker" });
		expect(getQueryTagComment()).toBe(
			"/*application='my%20app%27s%20worker'*/",
		);
	});

	it("returns an empty comment when no tags are set", () => {
		setQueryTags({});
		expect(getQueryTagComment()).toBe("");
	});
});

describe("patchClientQuery", () => {
	function makeClient() {
		const spy = vi.fn(() => Promise.resolve({ rows: [] }));
		const client = { query: spy } as unknown as PoolClient;
		return { client, spy };
	}

	it("appends the comment to string queries", async () => {
		setQueryTags({ application: "gateway" });
		const { client, spy } = makeClient();
		patchClientQuery(client);

		await client.query("SELECT 1");
		expect(spy).toHaveBeenCalledWith("SELECT 1 /*application='gateway'*/");
	});

	it("appends the comment to config-object queries and preserves values", async () => {
		setQueryTags({ application: "api" });
		const { client, spy } = makeClient();
		patchClientQuery(client);

		await client.query({ text: "SELECT $1", values: [1] });
		expect(spy).toHaveBeenCalledWith({
			text: "SELECT $1 /*application='api'*/",
			values: [1],
		});
	});

	it("does not tag when no tags are set", async () => {
		setQueryTags({});
		const { client, spy } = makeClient();
		patchClientQuery(client);

		await client.query("SELECT 1");
		expect(spy).toHaveBeenCalledWith("SELECT 1");
	});

	it("does not double-tag statements that already have a comment", async () => {
		setQueryTags({ application: "gateway" });
		const { client, spy } = makeClient();
		patchClientQuery(client);

		await client.query("SELECT 1 /*existing*/");
		expect(spy).toHaveBeenCalledWith("SELECT 1 /*existing*/");
	});

	it("leaves submittable configs untouched", async () => {
		setQueryTags({ application: "gateway" });
		const { client, spy } = makeClient();
		patchClientQuery(client);

		const submittable = { text: "SELECT 1", submit: () => undefined };
		await client.query(submittable as never);
		expect(spy).toHaveBeenCalledWith(submittable);
	});

	it("is idempotent", () => {
		setQueryTags({ application: "gateway" });
		const { client, spy } = makeClient();
		patchClientQuery(client);
		const patched = client.query;
		patchClientQuery(client);
		expect(client.query).toBe(patched);
		expect(client.query).not.toBe(spy);
	});
});
