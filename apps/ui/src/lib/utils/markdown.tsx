import { SyntaxHighlightedPre } from "./markdown-code-block";

export interface ChangelogFrontmatter {
	id: string;
	slug: string;
	date: string;
	title: string;
	summary: string;
	image: {
		src: string;
		alt: string;
		width: number;
		height: number;
	};
}

export interface ChangelogEntry extends ChangelogFrontmatter {
	content: string;
}

// Get markdown component options with custom styling
export function getMarkdownOptions() {
	return {
		overrides: {
			h1: {
				props: {
					className:
						"text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-6 mt-8 scroll-mt-20",
				},
			},
			h2: {
				props: {
					className:
						"text-2xl md:text-3xl font-semibold text-foreground mt-10 mb-4 scroll-mt-20 border-b border-border pb-2",
				},
			},
			h3: {
				props: {
					className:
						"text-xl md:text-2xl font-medium text-foreground mt-8 mb-3 scroll-mt-20",
				},
			},
			h4: {
				props: {
					className: "text-lg font-medium text-foreground mt-6 mb-2",
				},
			},
			p: {
				props: {
					className: "text-muted-foreground leading-7 mb-4",
				},
			},
			ul: {
				props: {
					className: "list-disc list-outside space-y-2 mb-4",
				},
			},
			ol: {
				props: {
					className: "list-decimal list-outside space-y-2 mb-4",
				},
			},
			li: {
				props: {
					className: "text-muted-foreground leading-7",
				},
			},
			strong: {
				props: {
					className: "text-foreground font-semibold",
				},
			},
			code: {
				props: {
					className:
						"bg-muted text-foreground px-1.5 py-0.5 rounded text-sm font-mono border border-border",
				},
			},
			pre: {
				component: SyntaxHighlightedPre,
			},
			blockquote: {
				props: {
					className:
						"border-l-4 border-primary pl-4 py-2 italic text-muted-foreground mb-4 bg-muted/30 rounded-r",
				},
			},
			a: {
				props: {
					className:
						"text-primary hover:text-primary/80 underline underline-offset-4 transition-colors",
				},
			},
			hr: {
				props: {
					className: "border-border my-8",
				},
			},
			table: {
				props: {
					className: "w-full border-collapse mb-4 text-sm",
				},
			},
			thead: {
				props: {
					className: "border-b-2 border-border",
				},
			},
			tbody: {
				props: {
					className: "divide-y divide-border",
				},
			},
			tr: {
				props: {
					className: "border-b border-border",
				},
			},
			th: {
				props: {
					className: "text-left font-semibold text-foreground p-3 bg-muted/50",
				},
			},
			td: {
				props: {
					className: "text-muted-foreground p-3",
				},
			},
		},
	};
}
