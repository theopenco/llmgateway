import { CheckCircle, Mail } from "lucide-react";

import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

import type { ComponentProps, ReactNode } from "react";

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

interface EnterpriseFeatureCardProps {
	/** e.g. "Audit logs are available on the Enterprise plan". */
	description: string;
	/** Intro paragraph. */
	children: ReactNode;
	features?: string[];
	/** Extra buttons shown next to "Contact Sales". */
	actions?: ReactNode;
}

/** Upsell shown in place of an Enterprise-only feature. */
export function EnterpriseFeatureCard({
	description,
	children,
	features,
	actions,
}: EnterpriseFeatureCardProps) {
	return (
		<Card className="max-w-2xl">
			<CardHeader>
				<CardTitle>Enterprise Feature</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<p className="text-muted-foreground">{children}</p>

				{features?.length ? (
					<div className="space-y-3">
						<h4 className="font-medium">What&apos;s included:</h4>
						<ul className="space-y-2">
							{features.map((feature) => (
								<li
									key={feature}
									className="flex items-center gap-2 text-sm text-muted-foreground"
								>
									<CheckCircle className="h-4 w-4 text-primary" />
									{feature}
								</li>
							))}
						</ul>
					</div>
				) : null}

				<div className="flex flex-wrap items-center gap-3">
					<ContactSalesButton />
					{actions}
				</div>
			</CardContent>
		</Card>
	);
}

/** {@link EnterpriseFeatureCard} as a full page with a title heading. */
export function EnterpriseFeaturePage({
	title,
	...props
}: EnterpriseFeatureCardProps & { title: string }) {
	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
						{title}
					</h2>
				</div>
				<EnterpriseFeatureCard {...props} />
			</div>
		</div>
	);
}
