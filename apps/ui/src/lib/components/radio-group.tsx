import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import * as React from "react";

import { cn } from "@/lib/utils";

const RadioGroup = ({
	ref,
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root> & {
	ref?: React.RefObject<React.ElementRef<
		typeof RadioGroupPrimitive.Root
	> | null>;
}) => {
	return (
		<RadioGroupPrimitive.Root
			className={cn("grid gap-2", className)}
			{...props}
			ref={ref}
		/>
	);
};
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const RadioGroupItem = ({
	ref,
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> & {
	ref?: React.RefObject<React.ElementRef<
		typeof RadioGroupPrimitive.Item
	> | null>;
}) => {
	return (
		<RadioGroupPrimitive.Item
			ref={ref}
			className={cn(
				"aspect-square h-4 w-4 rounded-full border border-primary text-primary ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		>
			<RadioGroupPrimitive.Indicator className="flex items-center justify-center">
				<div className="h-2 w-2 rounded-full bg-current" />
			</RadioGroupPrimitive.Indicator>
		</RadioGroupPrimitive.Item>
	);
};
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

export { RadioGroup, RadioGroupItem };
