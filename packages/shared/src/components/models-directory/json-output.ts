/**
 * Whether a provider mapping can return JSON at all — either legacy
 * `json_object` mode (`jsonOutput`) or schema-constrained output
 * (`jsonOutputSchema`).
 *
 * Must be an `||`, never a `??`: the catalogue leaves `jsonOutput` unset on
 * mappings that only advertise schema output, but the API serializes it from
 * the database, where the column is `NOT NULL DEFAULT false`. A `??` therefore
 * never falls through to `jsonOutputSchema` and silently drops those mappings.
 */
export function supportsJsonOutput(mapping: {
	jsonOutput?: boolean | null;
	jsonOutputSchema?: boolean | null;
}): boolean {
	return Boolean(mapping.jsonOutput || mapping.jsonOutputSchema);
}
