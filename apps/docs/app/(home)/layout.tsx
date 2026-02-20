import { DocsLayout } from "fumadocs-ui/layouts/docs";

import { baseOptions } from "@/app/layout.config";
import { GithubInfo } from "@/components/github-info";
import { source } from "@/lib/source";

import type { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

const docsOptions: DocsLayoutProps = {
	...baseOptions,

	tree: source.pageTree,

	links: [
		{
			type: "custom",
			children: (
				<GithubInfo
					owner="theopenco"
					repo="llmgateway"
					token={process.env.GITHUB_TOKEN}
					className="lg:-mx-2"
				/>
			),
		},
	],
};

export default function Layout({ children }: { children: ReactNode }) {
	return <DocsLayout {...docsOptions}>{children}</DocsLayout>;
}
