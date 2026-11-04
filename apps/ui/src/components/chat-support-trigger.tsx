import { MessageCircle, X } from "lucide-react";

import { cn } from "@/lib/utils";

import type { ComponentProps } from "react";

interface ChatSupportTriggerProps extends Omit<
	ComponentProps<"button">,
	"children"
> {
	isOpen: boolean;
	hasUnread: boolean;
}

export function ChatSupportTrigger({
	isOpen,
	hasUnread,
	className,
	...props
}: ChatSupportTriggerProps) {
	return (
		<button
			type="button"
			{...props}
			style={{
				bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
				right: "calc(1rem + env(safe-area-inset-right, 0px))",
				touchAction: "manipulation",
			}}
			className={cn(
				"fixed z-[70] flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-200 hover:bg-primary/90 hover:shadow-xl active:scale-95 sm:!right-6 sm:flex",
				isOpen && "rotate-90",
				isOpen && "hidden sm:flex",
				className,
			)}
			aria-label={isOpen ? "Close chat" : "Open chat support"}
		>
			{isOpen ? (
				<X className="size-5" />
			) : (
				<>
					<MessageCircle className="size-5" />
					{hasUnread && (
						<span className="absolute -right-0.5 -top-0.5 flex size-3">
							<span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-75" />
							<span className="relative inline-flex size-3 rounded-full bg-destructive" />
						</span>
					)}
				</>
			)}
		</button>
	);
}
