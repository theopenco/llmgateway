"use client";

import { Button } from "@/components/ui/button";

export default function ContentFilterError({ reset }: { reset: () => void }) {
	return (
		<div role="alert" className="mx-auto max-w-md space-y-4 p-8 text-center">
			<h1 className="text-xl font-semibold">
				Unable to load content filter data
			</h1>
			<p className="text-sm text-muted-foreground">
				Try again to reload the settings and activity.
			</p>
			<Button onClick={reset}>Try again</Button>
		</div>
	);
}
