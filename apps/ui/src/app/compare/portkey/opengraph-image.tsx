import { compareOgImage } from "@/app/compare/compare-og";
import { PortkeyOgIcon } from "@/app/compare/og-icons";

export {
	compareOgSize as size,
	compareOgContentType as contentType,
} from "../compare-og";

export default async function ComparePortkeyOgImage() {
	return compareOgImage({
		competitor: "Portkey",
		subtitle:
			"Compare open-source cores, hosted pricing, and prompt operations",
		Icon: PortkeyOgIcon,
	});
}
