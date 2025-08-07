import { defineCollection, defineConfig } from "@content-collections/core";
import { z } from "zod";

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

export default defineConfig({
	collections: [changelog],
});
