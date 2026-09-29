import { Mail } from "lucide-react";

import { Button } from "@/lib/components/button";

import type { ComponentProps } from "react";

/** Opens the enterprise page, where users can see the features and book a call. */
export function ContactSalesLink({
	children = "Contact sales",
	...props
}: Omit<ComponentProps<"a">, "href" | "target" | "rel">) {
	return (
		<a href="/enterprise" target="_blank" rel="noopener noreferrer" {...props}>
			{children}
		</a>
	);
}

export function ContactSalesButton(
	props: Pick<ComponentProps<typeof Button>, "variant" | "size" | "className">,
) {
	return (
		<Button asChild {...props}>
			<ContactSalesLink>
				<Mail className="h-4 w-4" />
				Contact Sales
			</ContactSalesLink>
		</Button>
	);
}
