/**
 * Serves the IndexNow key file. Search engines fetch it to confirm that URL
 * submissions for this host come from its owner.
 */
export function GET() {
	const key = process.env.INDEXNOW_KEY;
	if (!key) {
		return new Response("Not found", { status: 404 });
	}
	return new Response(key, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
