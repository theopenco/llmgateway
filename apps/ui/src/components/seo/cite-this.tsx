/** A ready-to-copy citation line for pages that publish original data. */
export function CiteThis({ citation }: { citation: string }) {
	return (
		<div className="rounded-lg border bg-muted/30 p-4">
			<h3 className="text-sm font-semibold">Cite this data</h3>
			<p className="mt-2 select-all text-sm text-muted-foreground">
				{citation}
			</p>
		</div>
	);
}
