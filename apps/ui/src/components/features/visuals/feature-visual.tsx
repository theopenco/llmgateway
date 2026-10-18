import {
	CheckoutVisual,
	FeedVisual,
	HealVisual,
	RankingVisual,
	ResponseVisual,
	TreeVisual,
	VersionsVisual,
} from "./data-visuals";
import { FlowVisual } from "./flow-visual";
import {
	AudioVisual,
	DocumentVisual,
	MediaVisual,
	VectorsVisual,
} from "./media-visuals";

import type { FeatureVisual as FeatureVisualData } from "@/lib/feature-visuals";

export function FeatureVisual({ visual }: { visual: FeatureVisualData }) {
	switch (visual.kind) {
		case "flow":
			return <FlowVisual {...visual} />;
		case "response":
			return <ResponseVisual {...visual} />;
		case "heal":
			return <HealVisual {...visual} />;
		case "ranking":
			return <RankingVisual {...visual} />;
		case "feed":
			return <FeedVisual {...visual} />;
		case "versions":
			return <VersionsVisual {...visual} />;
		case "tree":
			return <TreeVisual {...visual} />;
		case "checkout":
			return <CheckoutVisual {...visual} />;
		case "media":
			return <MediaVisual {...visual} />;
		case "audio":
			return <AudioVisual {...visual} />;
		case "document":
			return <DocumentVisual {...visual} />;
		case "vectors":
			return <VectorsVisual {...visual} />;
	}
}
