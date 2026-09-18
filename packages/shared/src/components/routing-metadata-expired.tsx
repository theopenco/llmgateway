import { Clock } from "lucide-react";

export function RoutingMetadataExpired() {
	return (
		<div className="flex items-start gap-2 text-sm">
			<Clock
				className="mt-0.5 size-4 shrink-0 text-muted-foreground"
				aria-hidden
			/>
			<div>
				<p className="font-medium">Routing metadata expired</p>
				<p className="mt-1 text-muted-foreground">
					Routing details are removed after 30 days. Usage and costs are still
					available.
				</p>
			</div>
		</div>
	);
}
