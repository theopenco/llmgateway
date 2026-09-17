"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
	createContext,
	useCallback,
	use,
	useMemo,
	useState,
	useTransition,
} from "react";

import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

interface FilterNavigationValue {
	/** A filter navigation (or refresh) is in flight and the server is re-querying. */
	isPending: boolean;
	/** Identifies the control that started it, so only that one shows a spinner. */
	pendingKey: string | null;
	navigate: (key: string, update: (params: URLSearchParams) => void) => void;
	refresh: (key: string) => void;
}

const FilterNavigationContext = createContext<FilterNavigationValue | null>(
	null,
);

export function useFilterNavigation(): FilterNavigationValue {
	const value = use(FilterNavigationContext);
	if (!value) {
		throw new Error(
			"useFilterNavigation must be used inside <FilterNavigationProvider>",
		);
	}
	return value;
}

/**
 * Tracks server-side filter navigations on pages whose queries are slow (raw
 * log scans), so every filter control can disable itself and show progress
 * until the new page data arrives.
 */
export function FilterNavigationProvider({
	children,
}: {
	children: ReactNode;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [isPending, startTransition] = useTransition();
	const [pendingKey, setPendingKey] = useState<string | null>(null);

	const navigate = useCallback(
		(key: string, update: (params: URLSearchParams) => void) => {
			const params = new URLSearchParams(searchParams.toString());
			update(params);
			const queryString = params.toString();
			setPendingKey(key);
			startTransition(() => {
				router.push(queryString ? `${pathname}?${queryString}` : pathname);
			});
		},
		[pathname, router, searchParams],
	);

	const refresh = useCallback(
		(key: string) => {
			setPendingKey(key);
			startTransition(() => {
				router.refresh();
			});
		},
		[router],
	);

	const value = useMemo(
		() => ({
			isPending,
			pendingKey: isPending ? pendingKey : null,
			navigate,
			refresh,
		}),
		[isPending, pendingKey, navigate, refresh],
	);

	return (
		<FilterNavigationContext value={value}>{children}</FilterNavigationContext>
	);
}

/** Dims and blocks the results while a filter navigation is in flight. */
export function FilterNavigationResults({
	children,
	message = "Loading…",
}: {
	children: ReactNode;
	message?: string;
}) {
	const { isPending } = useFilterNavigation();
	return (
		<div className="relative min-w-0" aria-busy={isPending}>
			<div
				className={cn(
					"min-w-0 transition-opacity",
					isPending && "pointer-events-none select-none opacity-40",
				)}
			>
				{children}
			</div>
			{isPending && (
				<div className="absolute inset-0 flex items-start justify-center pt-16">
					<span className="sticky top-8 flex items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-muted-foreground shadow-sm">
						<Loader2 className="h-4 w-4 animate-spin" />
						{message}
					</span>
				</div>
			)}
		</div>
	);
}

/** Spinner shown in place of a control's icon while that control is pending. */
export function FilterPendingSpinner({ className }: { className?: string }) {
	return <Loader2 className={cn("h-4 w-4 animate-spin", className)} />;
}
