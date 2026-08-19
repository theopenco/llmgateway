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
			"A managed, production-ready gateway instead of a proxy you operate yourself",
		Icon: LiteLLMOgIcon,
		iconSize: 64,
	});
}
