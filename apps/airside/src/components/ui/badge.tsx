import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"inline-flex items-center justify-center rounded-md border px-2 py-0.5 font-mono text-[0.7rem] font-medium tracking-wide uppercase w-fit whitespace-nowrap shrink-0 gap-1",
	{
		variants: {
			variant: {
				default: "border-transparent bg-primary text-primary-foreground",
				secondary: "border-transparent bg-secondary text-secondary-foreground",
				destructive:
					"border-transparent bg-destructive text-white dark:bg-destructive/70",
				outline: "text-foreground",
				success:
					"border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
				pending:
					"border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Badge({
	className,
	variant,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return (
		<span
			data-slot="badge"
			className={cn(badgeVariants({ variant }), className)}
			{...props}
		/>
	);
}

export { Badge, badgeVariants };
