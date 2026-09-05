import { HTTPException } from "hono/http-exception";
import { parseDocument } from "yaml";
import { z } from "zod";

import { db } from "@llmgateway/db";
import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";

import type { ServerTypes } from "@/vars.js";
import type { organizationSkill } from "@llmgateway/db";
import type { Context } from "hono";

const MAX_SKILL_BYTES = 1024 * 1024;

export const skillNameSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const fileSchema = z
	.object({
		path: z
			.string()
			.min(1)
			.max(200)
			.regex(/^[a-zA-Z0-9_][a-zA-Z0-9._/-]*$/)
			.refine(
				(path) =>
					path
						.split("/")
						.every(
							(part) =>
								part !== "" &&
								part !== "." &&
								part !== ".." &&
								!part.endsWith("."),
						) && path.split("/")[0].toLowerCase() !== "skill.md",
				"Use a relative file path; SKILL.md is supplied by content",
			),
		content: z.string().max(Math.ceil(MAX_SKILL_BYTES / 3) * 4),
		encoding: z.enum(["utf-8", "base64"]).optional(),
	})
	.refine(
		(file) =>
			file.encoding === "base64"
				? /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
						file.content,
					)
				: !file.content.includes("\0"),
		"Use UTF-8 text or valid base64",
	);

export const skillContentSchema = z
	.object({
		content: z.string().min(1).max(200_000),
		files: z.array(fileSchema).max(100).default([]),
	})
	.superRefine((value, context) => {
		const paths = value.files.map((file) => file.path.toLowerCase());
		if (
			new Set(paths).size !== paths.length ||
			paths.some((path) => paths.some((other) => other.startsWith(`${path}/`)))
		) {
			context.addIssue({
				code: "custom",
				message: "File paths must be unique and cannot overlap directories",
			});
		}
		if (
			Buffer.byteLength(value.content, "utf8") +
				value.files.reduce(
					(total, file) =>
						total +
						Buffer.byteLength(
							file.content,
							file.encoding === "base64" ? "base64" : "utf8",
						),
					0,
				) >
			MAX_SKILL_BYTES
		) {
			context.addIssue({
				code: "custom",
				message: "A skill must not exceed 1 MB",
			});
		}
	});

export const skillSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	enabled: z.boolean(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

export const organizationSkillSchema = skillSummarySchema.extend({
	content: z.string(),
	files: z.array(fileSchema),
});

export function parseOrganizationSkill(content: string) {
	const match = content.match(
		/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/,
	);
	if (!match || !match[2].trim()) {
		throw new HTTPException(400, {
			message: "SKILL.md needs YAML frontmatter and instructions",
		});
	}
	try {
		const document = parseDocument(match[1], { uniqueKeys: true });
		if (document.errors.length || document.warnings.length) {
			throw new Error("Invalid YAML");
		}
		return z
			.object({
				name: skillNameSchema,
				description: z.string().trim().min(1).max(1024),
			})
			.parse(document.toJS({ maxAliasCount: 0 }));
	} catch {
		throw new HTTPException(400, {
			message:
				"SKILL.md needs a lowercase, hyphenated name (up to 64 characters) and a description (up to 1024 characters) in valid YAML",
		});
	}
}

type OrganizationSkill = typeof organizationSkill.$inferSelect;

export const skillSummaryColumns = {
	id: true,
	name: true,
	description: true,
	enabled: true,
	createdAt: true,
	updatedAt: true,
} as const;

export function summarizeOrganizationSkill(
	skill: Pick<OrganizationSkill, keyof typeof skillSummaryColumns>,
) {
	return {
		id: skill.id,
		name: skill.name,
		description: skill.description,
		enabled: skill.enabled,
		createdAt: skill.createdAt.toISOString(),
		updatedAt: skill.updatedAt.toISOString(),
	};
}

export function serializeOrganizationSkill(skill: OrganizationSkill) {
	return {
		...summarizeOrganizationSkill(skill),
		content: skill.content,
		files: skill.files,
	};
}

export async function assertOrganizationSkillAccess(
	c: Context<ServerTypes>,
	organizationId: string,
	manage = false,
) {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const membership = await db.query.userOrganization.findFirst({
		where: { organizationId: { eq: organizationId }, userId: { eq: user.id } },
		with: { organization: true, user: true },
	});
	if (membership?.user?.status !== "active") {
		throw new HTTPException(404, { message: "Organization not found" });
	}
	if (
		!membership?.organization ||
		membership.organization.status !== "active"
	) {
		throw new HTTPException(404, { message: "Organization not found" });
	}
	if (manage && membership.role !== "owner" && membership.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only organization owners and admins can manage skills",
		});
	}
	if (
		!hasOrganizationEnterpriseAccess(
			organizationId,
			membership.organization.plan,
		)
	) {
		throw new HTTPException(403, {
			message: "Organization skills require an enterprise plan",
		});
	}
	return user;
}
