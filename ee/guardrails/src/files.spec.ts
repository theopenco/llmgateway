import { afterEach, describe, expect, it } from "vitest";

import { db, defaultSystemRulesConfig, eq, tables } from "@llmgateway/db";

import { checkGuardrails } from "./engine.js";
import { fileTypesRule } from "./rules/system/files.js";

import type { MessageContent } from "./types.js";

const organizations: string[] = [];
afterEach(async () => {
	for (const id of organizations.splice(0)) {
		await db.delete(tables.organization).where(eq(tables.organization.id, id));
	}
});

describe("file guardrails", () => {
	it.each([
		{ type: "image_url", image_url: { url: "DATA:image/png;base64,YQ==" } },
		{ type: "file", file: { file_data: "data:application/pdf;base64,YQ==" } },
		{ type: "file", file: { file_id: "provider-file" } },
		{ type: "input_audio", input_audio: { data: "YQ==", format: "wav" } },
	])(
		"checks multimodal attachments against the configured types: $type",
		async (content) => {
			const id = `file-guardrail-${crypto.randomUUID()}`;
			organizations.push(id);
			await db.insert(tables.organization).values({
				id,
				name: "Attachment test",
				billingEmail: "attachment@example.com",
			});
			await db.insert(tables.guardrailConfig).values({
				organizationId: id,
				enabled: true,
				allowedFileTypes: ["image/jpeg"],
				systemRules: {
					...defaultSystemRulesConfig,
					file_types: { enabled: true, action: "block" },
				},
			});
			const result = await checkGuardrails({
				organizationId: id,
				messages: [{ role: "user", content: [content as MessageContent] }],
			});
			expect(result.blocked).toBe(true);
			expect(result.violations).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ ruleId: "system:file_types" }),
				]),
			);
		},
	);

	it("honors a configured type beyond the default image allow-list", async () => {
		const id = `file-guardrail-${crypto.randomUUID()}`;
		organizations.push(id);
		await db.insert(tables.organization).values({
			id,
			name: "Attachment test",
			billingEmail: "attachment@example.com",
		});
		await db.insert(tables.guardrailConfig).values({
			organizationId: id,
			enabled: true,
			allowedFileTypes: ["application/pdf"],
			systemRules: {
				...defaultSystemRulesConfig,
				file_types: { enabled: true, action: "block" },
			},
		});
		const result = await checkGuardrails({
			organizationId: id,
			messages: [{ role: "user", content: "data:application/pdf;base64,YQ==" }],
		});
		expect(result.blocked).toBe(false);
	});

	it("ignores prose that only resembles a data URI", () => {
		const config = { enabled: true, action: "block" as const };
		for (const text of ["metadata:foo,bar", "userdata:abc,def", "data:, ok"]) {
			expect(fileTypesRule.check(text, config, ["image/png"]).passed).toBe(
				true,
			);
		}
		expect(
			fileTypesRule.check("x data:text/html;base64,YQ==", config, ["image/png"])
				.passed,
		).toBe(false);
	});
});
