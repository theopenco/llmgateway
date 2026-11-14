import { ogContentType, ogImage, ogSize } from "@/lib/og";
import { usageReportYears } from "@/lib/usage-report";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "State of LLM Usage — LLM Gateway";

// Satori cannot run at request time in production; prerender every year.
export const dynamicParams = false;

export function generateStaticParams() {
	return usageReportYears().map((year) => ({ year: String(year) }));
}

export default async function StateOfLlmUsageOgImage({
	params,
}: {
	params: Promise<{ year: string }>;
}) {
	const { year } = await params;
	return ogImage({
		eyebrow: "Annual report",
		title: `State of LLM Usage ${year}`,
		subtitle:
			"Which models, labs and providers carried production traffic, measured from real token volume on LLM Gateway.",
	});
}
