/**
 * Serialize a JSON-LD object for safe injection into an inline <script> tag.
 * Escapes "<" (as <) so a value containing "</script>" can't break out of
 * the tag. Use this for any dangerouslySetInnerHTML JSON-LD payload built from
 * data we don't fully control.
 */
export function serializeJsonLd(schema: unknown): string {
	return JSON.stringify(schema).replace(/</g, "\\u003c");
}
