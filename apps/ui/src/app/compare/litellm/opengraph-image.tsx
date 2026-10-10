import { compareOgImage } from "@/app/compare/compare-og";
import { LiteLLMOgIcon } from "@/app/compare/og-icons";

export {
	compareOgSize as size,
	compareOgContentType as contentType,
} from "../compare-og";

export default async function CompareLiteLLMOgImage() {
	return compareOgImage({
		competitor: "LiteLLM",
		subtitle:
			"Managed hosting or a self-operated gateway: compare costs and controls",
		Icon: LiteLLMOgIcon,
		iconSize: 64,
	});
}
