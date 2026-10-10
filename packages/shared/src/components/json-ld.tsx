/**
 * Renders schema.org JSON-LD. `<` is escaped so string values can never close
 * the script tag early.
 */
export function JsonLd({ data }: { data: object }) {
	return (
		<script
			type="application/ld+json"
			dangerouslySetInnerHTML={{
				__html: JSON.stringify(data).replace(/</g, "\\u003c"),
			}}
		/>
	);
}
