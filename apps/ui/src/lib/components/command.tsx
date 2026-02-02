"use client";

import { Command as CommandPrimitive } from "cmdk";
import * as React from "react";

import { cn } from "@/lib/utils";

const Command = ({
	ref,
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive> & {
	ref?: React.RefObject<React.ElementRef<typeof CommandPrimitive> | null>;
}) => (
	<CommandPrimitive
		ref={ref}
		className={cn(
			"flex h-full w-full flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground",
			className,
		)}
		{...props}
	/>
);
Command.displayName = "Command";

const CommandInput = ({
	ref,
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> & {
	ref?: React.RefObject<React.ElementRef<typeof CommandPrimitive.Input> | null>;
}) => (
	<div className="flex items-center border-b px-2 w-full" cmdk-input-wrapper="">
		<CommandPrimitive.Input
			ref={ref}
			className={cn(
				"flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground",
				className,
			)}
			{...props}
		/>
	</div>
);
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = ({
	ref,
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive.List> & {
	ref?: React.RefObject<React.ElementRef<typeof CommandPrimitive.List> | null>;
}) => (
	<CommandPrimitive.List
		ref={ref}
		className={cn("max-h-60 overflow-y-auto p-1", className)}
		{...props}
	/>
);
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = ({
	ref,
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty> & {
	ref?: React.RefObject<React.ElementRef<typeof CommandPrimitive.Empty> | null>;
}) => (
	<CommandPrimitive.Empty
		ref={ref}
		className={cn("py-6 text-center text-sm", className)}
		{...props}
	/>
);
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = ({
	ref,
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group> & {
	ref?: React.RefObject<React.ElementRef<typeof CommandPrimitive.Group> | null>;
}) => (
	<CommandPrimitive.Group
		ref={ref}
		className={cn(
			"overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
			className,
		)}
		{...props}
	/>
);
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandItem = ({
	ref,
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item> & {
	ref?: React.RefObject<React.ElementRef<typeof CommandPrimitive.Item> | null>;
}) => (
	<CommandPrimitive.Item
		ref={ref}
		className={cn(
			"relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
			className,
		)}
		{...props}
	/>
);
CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandSeparator = ({
	ref,
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator> & {
	ref?: React.RefObject<React.ElementRef<
		typeof CommandPrimitive.Separator
	> | null>;
}) => (
	<CommandPrimitive.Separator
		ref={ref}
		className={cn("-mx-1 h-px bg-border", className)}
		{...props}
	/>
);
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

export {
	Command,
	CommandInput,
	CommandList,
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandSeparator,
};
