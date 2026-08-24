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
			"A fully open-source platform under AGPLv3, not just an open gateway",
		Icon: PortkeyOgIcon,
	});
}
