type JsonLdData = Record<string, unknown>;

interface JsonLdProps {
	data: JsonLdData | JsonLdData[];
}

/**
 * Renders a JSON-LD structured data script tag. Works in server components
 * and is included in the SSR HTML so crawlers can read it without JS.
 */
export function JsonLd({ data }: JsonLdProps) {
	return (
		<script
			type="application/ld+json"
			// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
			dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
		/>
	);
}
