import Link from "next/link";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Page Not Found",
};

export default function NotFound() {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
			<h1 className="text-4xl font-bold">404</h1>
			<p className="text-muted-foreground">
				The page you&apos;re looking for doesn&apos;t exist.
			</p>
			<Link
				href="/"
				className="text-primary underline underline-offset-4 hover:text-primary/80"
			>
				Go back home
			</Link>
		</div>
	);
}
