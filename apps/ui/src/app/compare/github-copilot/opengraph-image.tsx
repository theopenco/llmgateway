import { compareOgImage } from "@/app/compare/compare-og";
import { GitHubCopilotOgIcon } from "@/app/compare/og-icons";

export {
	compareOgSize as size,
	compareOgContentType as contentType,
} from "../compare-og";

export default async function CompareGitHubCopilotOgImage() {
	return compareOgImage({
		competitor: "GitHub Copilot",
		subtitle:
			"Model routing, usage analytics, and budgets for compatible coding tools",
		Icon: GitHubCopilotOgIcon,
	});
}
