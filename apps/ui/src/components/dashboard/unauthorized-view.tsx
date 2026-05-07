import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { Button } from "@/lib/components/button";

interface UnauthorizedViewProps {
	resource?: "organization" | "project";
}

export function UnauthorizedView({
	resource = "organization",
}: UnauthorizedViewProps) {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center px-4">
			<ShieldAlert className="h-12 w-12 text-muted-foreground" />
			<div className="space-y-1">
				<h1 className="text-2xl font-bold">Unauthorized</h1>
				<p className="text-muted-foreground max-w-md">
					You don&apos;t have access to this {resource}, or it doesn&apos;t
					exist.
				</p>
			</div>
			<Button asChild>
				<Link href="/dashboard">Go to your dashboard</Link>
			</Button>
		</div>
	);
}
