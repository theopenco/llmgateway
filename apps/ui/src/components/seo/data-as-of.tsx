import { cn } from "@/lib/utils";

/**
 * States when the catalogue data on a page was read. Pages render from the
 * live catalogue and revalidate, so the render time is the data's as-of time.
 */
export function DataAsOf({
	label = "Pricing and availability as of",
	className,
}: {
	label?: string;
	className?: string;
}) {
	const now = new Date();
	return (
		<p className={cn("text-sm text-muted-foreground", className)}>
			{label}{" "}
			<time dateTime={now.toISOString()}>
				{now.toLocaleDateString("en-US", {
					year: "numeric",
					month: "long",
					day: "numeric",
					timeZone: "UTC",
				})}
			</time>
		</p>
	);
}
