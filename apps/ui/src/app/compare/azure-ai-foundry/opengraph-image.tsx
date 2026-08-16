import { compareOgImage } from "@/app/compare/compare-og";
import { AzureOgIcon } from "@/app/compare/og-icons";

export {
	compareOgSize as size,
	compareOgContentType as contentType,
} from "../compare-og";

export default async function CompareAzureAiFoundryOgImage() {
	return compareOgImage({
		competitor: "Azure AI Foundry",
		subtitle:
			"One key for every provider — no resources, deployments, or quota to provision",
		Icon: AzureOgIcon,
	});
}
