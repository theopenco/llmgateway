import { z } from "zod";

const sourceSchema = z.object({
	type: z.literal("source-url"),
	sourceId: z.string(),
	url: z.string(),
	title: z.string().optional(),
});
export type Source = z.infer<typeof sourceSchema>;

export function readSources(raw?: string | null): Source[] {
	try {
		return raw ? z.array(sourceSchema).parse(JSON.parse(raw)) : [];
	} catch (cause) {
		throw new Error(
			"Saved source links could not be read. Please reload this conversation.",
			{ cause },
		);
	}
}

export function mergeSources(previous: Source[], incoming: Source[]): Source[] {
	const sources = new Map(previous.map((source) => [source.url, source]));
	for (const source of incoming) {
		sources.set(source.url, source);
	}
	return [...sources.values()];
}

export function citationSources(annotations: unknown): Source[] {
	const citations = z
		.array(
			z.object({
				type: z.string(),
				url_citation: z
					.object({ url: z.string(), title: z.string().optional() })
					.optional(),
			}),
		)
		.safeParse(annotations);
	if (!citations.success) {
		return [];
	}
	return citations.data.flatMap((annotation) => {
		if (annotation.type !== "url_citation" || !annotation.url_citation) {
			return [];
		}
		const { url, title } = annotation.url_citation;
		return [{ type: "source-url", sourceId: url, url, title }];
	});
}
