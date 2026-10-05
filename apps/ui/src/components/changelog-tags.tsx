import Link from "next/link";

import { changelogPath, changelogProducts } from "@/lib/changelog";

import type { ChangelogTag } from "@/lib/changelog";

export function ChangelogTags({ tags }: { tags: ChangelogTag[] }) {
	return (
		<ul aria-label="Products" className="not-prose flex flex-wrap gap-2">
			{tags.map((tag) => (
				<li key={tag}>
					<Link
						href={changelogPath(tag)}
						className="inline-flex min-h-8 items-center rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					>
						{changelogProducts[tag].name}
					</Link>
				</li>
			))}
		</ul>
	);
}
