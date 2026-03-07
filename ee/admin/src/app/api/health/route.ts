export async function GET() {
	return Response.json({
		status: "ok",
		sha: process.env.APP_VERSION ?? "v0.0.0-unknown",
	});
}
