export type FlowStatus = "active" | "fallback" | "blocked" | "idle";

export type FeedTone = "ok" | "info" | "warn" | "error";

export type FeatureVisual =
	| {
			kind: "flow";
			source: string;
			hub: string;
			targets: Array<{ label: string; status: FlowStatus; note?: string }>;
			caption?: string;
	  }
	| {
			kind: "response";
			title: string;
			lines: Array<{ text: string; highlight?: boolean }>;
			footer?: string;
	  }
	| { kind: "heal"; broken: string[]; fixed: string[] }
	| {
			kind: "ranking";
			title: string;
			query?: string;
			items: Array<{
				label: string;
				value: number;
				display: string;
				tone?: "accent" | "muted" | "warn";
			}>;
	  }
	| {
			kind: "media";
			output: "image" | "video";
			prompt: string;
			meta: string;
			sources: string[];
			poster?: string;
	  }
	| {
			kind: "audio";
			mode: "speech" | "transcription" | "realtime";
			title: string;
			words: string[];
			meta: string;
			src?: string;
			times?: Array<[number, number]>;
	  }
	| {
			kind: "document";
			mode: "ocr" | "documents" | "vision";
			title: string;
			output: string[];
			image?: string;
	  }
	| {
			kind: "feed";
			title: string;
			items: Array<{ title: string; meta: string; tone: FeedTone }>;
	  }
	| {
			kind: "versions";
			name: string;
			versions: Array<{ id: string; note: string }>;
			labels: Array<{ name: string; from: number; to: number }>;
	  }
	| {
			kind: "tree";
			root: string;
			branches: Array<{ label: string; badge?: string; children: string[] }>;
	  }
	| {
			kind: "checkout";
			brand: string;
			balance: string;
			packs: string[];
			charges: string[];
			margin: number;
	  }
	| { kind: "vectors"; query: string; clusters: [string, string, string] };
