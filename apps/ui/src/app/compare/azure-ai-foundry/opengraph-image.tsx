import { compareOgImage } from "@/app/compare/compare-og";
import { AzureOgIcon } from "@/app/compare/og-icons";

export {
	compareOgSize as size,
	compareOgContentType as contentType,
} from "../compare-og";

export default async function CompareAzureAiFoundryOgImage() {
	return compareOgImage({
		competitor: "Microsoft Foundry",
		subtitle: "Cross-provider access; Azure BYOK quotas still apply",
		Icon: AzureOgIcon,
	});
}
