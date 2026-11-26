/**
 * `experimental_download` for AI SDK calls. Never fetch a message URL in
 * process: the SDK's own SSRF guard is bypassed wherever `fetch` is patched
 * (every Next.js route), so URLs pass through to the gateway, which validates
 * and fetches them.
 */
export async function deferDownloadsToGateway(
	files: readonly unknown[],
): Promise<null[]> {
	return files.map(() => null);
}
