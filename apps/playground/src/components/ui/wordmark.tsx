import { Logo } from "@/components/ui/logo";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

interface WordmarkProps {
	className?: string;
	markClassName?: string;
	/** md matches the old text-xl headers, sm the sidebar menu buttons. */
	size?: "sm" | "md";
	/** Show the "by LLM Gateway" byline under the name. */
	byline?: boolean;
	/**
	 * Wrap the mark in the size-8 square the sidebar menu buttons use so the
	 * icon stays centered when the sidebar collapses to icon mode.
	 */
	iconBox?: boolean;
}

/**
 * Renders the mark and the label as sibling elements (no wrapping span) so
 * that inside SidebarMenuButton the `[&>span:last-child]:truncate` rule only
 * ever truncates the text column, never the mark. All call sites place the
 * lockup inside a flex parent with its own gap.
 */
export function Wordmark({
	className,
	markClassName,
	size = "md",
	byline = true,
	iconBox = false,
}: WordmarkProps) {
	const mark = <Logo className={cn("size-6 shrink-0", markClassName)} />;

	return (
		<>
			{iconBox ? (
				<span
					aria-hidden
					className="flex aspect-square size-8 shrink-0 items-center justify-center"
				>
					{mark}
				</span>
			) : (
				mark
			)}
			<span
				aria-label={BRAND.fullName}
				className={cn("flex min-w-0 flex-col justify-center", className)}
			>
				<span
					className={cn(
						"font-display font-semibold leading-none tracking-tight",
						size === "md" ? "text-xl" : "text-lg",
					)}
				>
					{BRAND.name}
				</span>
				{byline && (
					<span className="mt-1 whitespace-nowrap text-[9px] font-medium uppercase leading-none tracking-[0.22em] text-muted-foreground">
						by {BRAND.publisher}
					</span>
				)}
			</span>
		</>
	);
}
