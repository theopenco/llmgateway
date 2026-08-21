import { Avatar, AvatarFallback, AvatarImage } from "@/lib/components/avatar";
import { cn } from "@/lib/utils";

import type { Organization } from "@/lib/types";

function getOrganizationInitials(name: string): string {
	return (
		name
			.split(" ")
			.filter(Boolean)
			.map((word) => word[0])
			.join("")
			.toUpperCase()
			.slice(0, 2) || "?"
	);
}

export function OrganizationAvatar({
	organization,
	className,
}: {
	organization: Pick<Organization, "name" | "logo">;
	className?: string;
}) {
	return (
		<Avatar className={cn("h-5 w-5 rounded-md", className)}>
			{organization.logo && (
				<AvatarImage
					src={organization.logo}
					alt={`${organization.name} logo`}
					className="rounded-md object-cover"
				/>
			)}
			<AvatarFallback className="rounded-md bg-muted text-[0.6rem] font-semibold text-muted-foreground">
				{getOrganizationInitials(organization.name)}
			</AvatarFallback>
		</Avatar>
	);
}
