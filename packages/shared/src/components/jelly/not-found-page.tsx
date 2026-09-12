import { JellyLogo } from "./jelly-logo";

import type { ReactNode } from "react";

export function NotFoundPage({ children }: { children: ReactNode }) {
	return (
		<main className="flex min-h-svh flex-col items-center justify-center overflow-hidden bg-background px-6 py-12 text-center text-foreground">
			<div className="w-full max-w-5xl">
				<p className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
					Error / 404
				</p>
				<JellyLogo />
				<div className="mt-9">
					<h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
						This page slipped away.
					</h1>
					<p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
						The page you&apos;re looking for doesn&apos;t exist.
					</p>
					<div className="mt-7 text-sm">{children}</div>
				</div>
			</div>
		</main>
	);
}
