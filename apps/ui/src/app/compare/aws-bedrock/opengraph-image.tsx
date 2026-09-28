import { compareOgImage } from "@/app/compare/compare-og";
import { AwsBedrockOgIcon } from "@/app/compare/og-icons";

export {
	compareOgSize as size,
	compareOgContentType as contentType,
} from "../compare-og";

export default async function CompareAwsBedrockOgImage() {
	return compareOgImage({
		competitor: "AWS Bedrock",
		subtitle:
			"Multiple labs and clouds — Bedrock included — behind one OpenAI-compatible API",
		Icon: AwsBedrockOgIcon,
		iconSize: 88,
	});
}
