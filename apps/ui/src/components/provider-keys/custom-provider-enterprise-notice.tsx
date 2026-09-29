import { Lock } from "lucide-react";

import { ContactSalesLink } from "@/components/contact-sales";
import { Alert, AlertDescription, AlertTitle } from "@/lib/components/alert";

interface CustomProviderEnterpriseNoticeProps {
	hasExistingKeys?: boolean;
	className?: string;
}

export function CustomProviderEnterpriseNotice({
	hasExistingKeys = false,
	className,
}: CustomProviderEnterpriseNoticeProps) {
	return (
		<Alert className={className}>
			<Lock />
			<AlertTitle>Custom providers are Enterprise only</AlertTitle>
			<AlertDescription>
				<p>
					{hasExistingKeys
						? "Your existing custom providers keep working and can still be deactivated or deleted, but adding or editing them requires an Enterprise plan."
						: "Adding a custom OpenAI-compatible provider requires an Enterprise plan."}{" "}
					<ContactSalesLink className="whitespace-nowrap text-foreground underline underline-offset-4" />
				</p>
			</AlertDescription>
		</Alert>
	);
}
