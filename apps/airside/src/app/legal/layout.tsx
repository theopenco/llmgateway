import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

export default function LegalLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="flex min-h-screen flex-col">
			<Header />
			<main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
				<Link
					href="/"
					className="text-muted-foreground hover:text-foreground mb-8 inline-flex items-center gap-1.5 text-sm transition-colors"
				>
					<ArrowLeft className="size-4" />
					Back to Airside
				</Link>
				<article className="text-muted-foreground space-y-4 text-sm leading-relaxed [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_h1]:font-display [&_h1]:text-foreground [&_h1]:mb-2 [&_h1]:text-3xl [&_h1]:font-black [&_h1]:tracking-tight [&_h2]:font-display [&_h2]:text-foreground [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h3]:font-display [&_h3]:text-foreground [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-bold [&_hr]:border-border/60 [&_hr]:my-8 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-6 [&_strong]:text-foreground [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6">
					{children}
				</article>
			</main>
			<Footer />
		</div>
	);
}
