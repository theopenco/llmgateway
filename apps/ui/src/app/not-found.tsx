import Link from "next/link";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Page Not Found",
};

const linkClass =
	"text-primary underline underline-offset-4 hover:text-primary/80";

export default function NotFound() {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
			<h1 className="text-4xl font-bold">404</h1>
			<p className="text-muted-foreground">
				The page you&apos;re looking for doesn&apos;t exist.
			</p>
			<nav aria-label="Suggested pages">
				<ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
					<li>
						<Link href="/" className={linkClass}>
							Homepage
						</Link>
					</li>
					<li>
						<Link href="/models" className={linkClass}>
							Model catalog
						</Link>
					</li>
					<li>
						<Link href="/pricing" className={linkClass}>
							Pricing
						</Link>
					</li>
					<li>
						<a href="https://docs.llmgateway.io" className={linkClass}>
							Documentation
						</a>
					</li>
					<li>
						<a href="/llms.txt" className={linkClass}>
							llms.txt
						</a>
					</li>
					<li>
						<a href="/sitemap.xml" className={linkClass}>
							Sitemap
						</a>
					</li>
					<li>
						<a href="/openapi.json" className={linkClass}>
							OpenAPI spec
						</a>
					</li>
				</ul>
			</nav>
		</div>
	);
}
