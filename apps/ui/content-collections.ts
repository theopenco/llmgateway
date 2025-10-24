import { defineCollection, defineConfig } from "@content-collections/core";
import * as z from "zod";

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
		title: z.string(),
		summary: z.string(),
		draft: z.boolean().optional(),
		categories: z.array(z.string()).default([]),
		image: z
			.object({
				src: z.string(),
				alt: z.string(),
				width: z.number(),
				height: z.number(),
			})
			.optional(),
	}),
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

export default defineConfig({
	collections: [changelog, blog, legal],
});
