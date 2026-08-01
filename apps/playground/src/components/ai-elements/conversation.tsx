"use client";

import { ArrowDownIcon } from "lucide-react";
import { createContext, use } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ComponentProps } from "react";

export interface VirtualScrollContextValue {
	isAtEnd: boolean;
	scrollToEnd: () => void;
}

export const VirtualScrollContext =
	createContext<VirtualScrollContextValue | null>(null);

export function useVirtualScrollContext() {
	const ctx = use(VirtualScrollContext);
	if (!ctx) {
		throw new Error(
			"useVirtualScrollContext must be used inside VirtualScrollContext.Provider",
		);
	}
	return ctx;
}

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
	className,
	...props
}: ConversationScrollButtonProps) => {
	const { isAtEnd, scrollToEnd } = useVirtualScrollContext();

	return !isAtEnd ? (
		<Button
			className={cn(
				"absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full",
				className,
			)}
			onClick={scrollToEnd}
			size="icon"
			type="button"
			variant="outline"
			{...props}
		>
			<ArrowDownIcon className="size-4" />
		</Button>
	) : null;
};
