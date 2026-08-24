import { compareOgImage } from "@/app/compare/compare-og";
import { VercelOgIcon } from "@/app/compare/og-icons";

export {
	compareOgSize as size,
	compareOgContentType as contentType,
} from "../compare-og";

export default async function CompareVercelAiGatewayOgImage() {
	return compareOgImage({
		competitor: "Vercel AI Gateway",
		subtitle:
			"Self-hostable routing with zero token markup, tied to no single platform",
		Icon: VercelOgIcon,
	});
}
