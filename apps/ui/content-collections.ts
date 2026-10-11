import { defineCollection, defineConfig } from "@content-collections/core";
import * as z from "zod";

import { interpolateRoutingDefaults } from "@llmgateway/shared/routing-defaults";

import { changelogTags } from "./src/lib/changelog";

/**
 * Resolves `%routing.<path>%` tokens in every string field (body and
 * frontmatter) so evergreen content always quotes the live routing defaults.
 * Changelog entries are point-in-time records and are left untouched.
 */
function withRoutingDefaults<T>(value: T): T {
	if (typeof value === "string") {
		return interpolateRoutingDefaults(value) as T;
	}
	if (Array.isArray(value)) {
		return value.map(withRoutingDefaults) as T;
	}
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [
				key,
				withRoutingDefaults(entry),
			]),
		) as T;
	}
	return value;
}

const changelog = defineCollection({
	name: "changelog",
	directory: "src/content/changelog",
	include: "**/*.md",
	schema: z.object({
		id: z.string(),
		slug: z.string(),
		date: z.string(),
		title: z.string(),
		summary: z.string(),
		tags: z.array(z.enum(changelogTags)).min(1),
		draft: z.boolean().optional(),
		image: z.object({
			src: z.string(),
			alt: z.string(),
			width: z.number(),
			height: z.number(),
		}),
	}),
});

const blog = defineCollection({
	name: "blog",
	directory: "src/content/blog",
	include: "**/*.md",
	schema: z.object({
		id: z.string(),
		slug: z.string(),
		date: z.string(),
		updatedAt: z.string().optional(),
		author: z
			.object({ name: z.string(), url: z.string().url().optional() })
			.optional(),
		title: z.string(),
		summary: z.string(),
		draft: z.boolean().optional(),
		categories: z.array(z.string()).default([]),
		// Catalogue id of the model a post is specifically about, so the
		// conversion rail can send the reader to that model instead of the
		// full catalogue.
		model: z.string().optional(),
		faqs: z
			.array(
				z.object({
					question: z.string(),
					answer: z.string(),
				}),
			)
			.default([]),
		image: z
			.object({
				src: z.string(),
				alt: z.string(),
				width: z.number(),
				height: z.number(),
			})
			.optional(),
	}),
	transform: (document) => withRoutingDefaults(document),
});

const legal = defineCollection({
	name: "legal",
	directory: "src/content/legal",
	include: "**/*.md",
	schema: z.object({
		id: z.string(),
		slug: z.string(),
		date: z.string(),
		title: z.string(),
		description: z.string(),
	}),
});

const guides = defineCollection({
	name: "guides",
	directory: "src/content/guides",
	include: "**/*.md",
	schema: z.object({
		id: z.string(),
		slug: z.string(),
		title: z.string(),
		// Optional longer <title> for search results. `title` stays short so the
		// index cards and page heading read cleanly.
		seoTitle: z.string().optional(),
		description: z.string(),
		date: z.string(),
		image: z
			.object({
				src: z.string(),
				alt: z.string(),
				width: z.number(),
				height: z.number(),
			})
			.optional(),
	}),
	transform: (document) => withRoutingDefaults(document),
});

const migrations = defineCollection({
	name: "migrations",
	directory: "src/content/migrations",
	include: "**/*.md",
	schema: z.object({
		id: z.string(),
		slug: z.string(),
		title: z.string(),
		description: z.string(),
		date: z.string(),
		updatedAt: z.string().optional(),
		fromProvider: z.string(),
	}),
	transform: (document) => withRoutingDefaults(document),
});

const useCases = defineCollection({
	name: "useCases",
	directory: "src/content/use-cases",
	include: "**/*.md",
	schema: z.object({
		id: z.string(),
		slug: z.string(),
		date: z.string(),
		draft: z.boolean().optional(),
		title: z.string(),
		metaTitle: z.string().optional(),
		description: z.string(),
		headline: z.string(),
		summary: z.string(),
		benefits: z
			.array(
				z.object({
					title: z.string(),
					description: z.string(),
				}),
			)
			.default([]),
		faqs: z
			.array(
				z.object({
					question: z.string(),
					answer: z.string(),
				}),
			)
			.default([]),
	}),
	transform: (document) => withRoutingDefaults(document),
});

export default defineConfig({
	collections: [changelog, blog, legal, guides, migrations, useCases],
});
