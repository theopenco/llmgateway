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
			"Zero token markup, hard budget caps, and 200+ models for any coding agent",
		Icon: GitHubCopilotOgIcon,
	});
}
