import { devpassOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "DevPass Model Census — coding models rated by developers";
export const size = ogSize;
export const contentType = ogContentType;

export default async function ModelCensusOgImage({
	params,
}: {
	params: Promise<{ year: string }>;
}) {
	const { year } = await params;
	return devpassOgImage({
		eyebrow: `${year} Model Census`,
		title: "Which coding models are actually worth the money?",
		subtitle:
			"Value, quality, and speed scores from DevPass developers with verified real-world usage.",
		path: `/data/${year}`,
	});
}
