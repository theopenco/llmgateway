import { defineCollection, defineConfig } from "@content-collections/core";
import * as z from "zod";

const featureRow = z.object({
	label: z.string(),
	devpass: z.union([z.string(), z.boolean()]),
	competitor: z.union([z.string(), z.boolean()]),
	highlight: z.boolean().optional(),
});

const faqItem = z.object({
	question: z.string(),
	answer: z.string(),
});

const comparisons = defineCollection({
	name: "comparisons",
	directory: "src/content/comparisons",
	include: "**/*.md",
	schema: z.object({
		id: z.string(),
		slug: z.string(),
		date: z.string(),
		draft: z.boolean().optional(),
		// Page + SEO
		title: z.string(),
		metaTitle: z.string().optional(),
		description: z.string(),
		// Hero
		competitor: z.string(),
		// Key into the brand-logos registry (e.g. "cursor", "opencode"). When
		// omitted the UI falls back to a monogram tile built from the competitor.
		competitorLogo: z.string().optional(),
		competitorTagline: z.string(),
		tagline: z.string(),
		devpassPrice: z.string(),
		competitorPrice: z.string(),
		// Quick verdict shown above the table
		verdict: z.string(),
		// Structured comparison table
		features: z.array(featureRow),
		// FAQ (rendered + emitted as FAQPage JSON-LD)
		faqs: z.array(faqItem).default([]),
	}),
});

export default defineConfig({
	collections: [comparisons],
});
