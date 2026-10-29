import { buildSecurityTxt } from "@llmgateway/shared/security-txt";

export function GET() {
	return new Response(buildSecurityTxt(), {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "public, max-age=86400",
		},
	});
}
