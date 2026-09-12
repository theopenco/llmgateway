import { Layers3, Users } from "lucide-react";
import Link from "next/link";

import { Button } from "@/lib/components/button";
import { cn } from "@/lib/utils";

import type { Route } from "next";

export function TeamTabs({
	active,
	teamUrl,
}: {
	active: "members" | "teams";
	teamUrl: string;
}) {
	return (
		<nav
			className="bg-muted/50 inline-flex w-fit gap-1 rounded-lg p-1"
			aria-label="Team sections"
		>
			<Button
				asChild
				variant="ghost"
				size="sm"
				className={cn(active === "members" && "bg-background shadow-sm")}
			>
				<Link
					href={teamUrl as Route}
					aria-current={active === "members" ? "page" : undefined}
				>
					<Users className="mr-2 h-4 w-4" />
					Members
				</Link>
			</Button>
			<Button
				asChild
				variant="ghost"
				size="sm"
				className={cn(active === "teams" && "bg-background shadow-sm")}
			>
				<Link
					href={`${teamUrl}?tab=teams` as Route}
					aria-current={active === "teams" ? "page" : undefined}
				>
					<Layers3 className="mr-2 h-4 w-4" />
					Teams
				</Link>
			</Button>
		</nav>
	);
}
