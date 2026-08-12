import { compareOgImage } from "@/app/compare/compare-og";
import { OpenRouterOgIcon } from "@/app/compare/og-icons";

export {
	compareOgSize as size,
	compareOgContentType as contentType,
} from "../compare-og";

export default async function CompareOpenRouterOgImage() {
	return compareOgImage({
		competitor: "OpenRouter",
		subtitle:
			"Open-source routing you can self-host, with transparent per-token pricing",
		Icon: OpenRouterOgIcon,
	});
}
