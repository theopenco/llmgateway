import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as React from "react";

import { cn } from "@/lib/utils";

const Avatar = ({
	ref,
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & {
	ref?: React.RefObject<React.ElementRef<typeof AvatarPrimitive.Root> | null>;
}) => (
	<AvatarPrimitive.Root
		ref={ref}
		className={cn(
			"relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
			className,
		)}
		{...props}
	/>
);
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = ({
	ref,
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image> & {
	ref?: React.RefObject<React.ElementRef<typeof AvatarPrimitive.Image> | null>;
}) => (
	<AvatarPrimitive.Image
		ref={ref}
		className={cn("aspect-square h-full w-full", className)}
		{...props}
	/>
);
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = ({
	ref,
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback> & {
	ref?: React.RefObject<React.ElementRef<
		typeof AvatarPrimitive.Fallback
	> | null>;
}) => (
	<AvatarPrimitive.Fallback
		ref={ref}
		className={cn(
			"bg-muted flex h-full w-full items-center justify-center rounded-full",
			className,
		)}
		{...props}
	/>
);
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarImage, AvatarFallback };
