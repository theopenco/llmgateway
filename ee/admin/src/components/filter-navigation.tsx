"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
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

import type { ComponentProps, ReactNode } from "react";

interface NavigateOptions {
	/** Replace the history entry and keep the scroll position. */
	replace?: boolean;
}

interface FilterNavigationValue {
	/** A filter navigation (or refresh) is in flight and the server is re-querying. */
	isPending: boolean;
	/** Identifies the control that started it, so only that one shows a spinner. */
	pendingKey: string | null;
	navigate: (
		key: string,
		update: (params: URLSearchParams) => void,
		options?: NavigateOptions,
	) => void;
	navigateTo: (key: string, href: string, options?: NavigateOptions) => void;
	refresh: (key: string) => void;
}

const FilterNavigationContext = createContext<FilterNavigationValue | null>(
	null,
);

function useFilterNavigationState(): FilterNavigationValue {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [isPending, startTransition] = useTransition();
	const [pendingKey, setPendingKey] = useState<string | null>(null);

	const navigateTo = useCallback(
		(key: string, href: string, options?: NavigateOptions) => {
			setPendingKey(key);
			startTransition(() => {
				if (options?.replace) {
					router.replace(href, { scroll: false });
				} else {
					router.push(href);
				}
			});
		},
		[router],
	);

	const navigate = useCallback(
		(
			key: string,
			update: (params: URLSearchParams) => void,
			options?: NavigateOptions,
		) => {
			const params = new URLSearchParams(searchParams.toString());
			update(params);
			const queryString = params.toString();
			navigateTo(
				key,
				queryString ? `${pathname}?${queryString}` : pathname,
				options,
			);
		},
		[navigateTo, pathname, searchParams],
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

	return useMemo(
		() => ({
			isPending,
			pendingKey: isPending ? pendingKey : null,
			navigate,
			navigateTo,
			refresh,
		}),
		[isPending, pendingKey, navigate, navigateTo, refresh],
	);
}

/**
 * Filter navigation shared with the surrounding <FilterNavigationProvider>.
 * Outside a provider the pending state is local to the calling control.
 */
export function useFilterNavigation(): FilterNavigationValue {
	const shared = use(FilterNavigationContext);
	const local = useFilterNavigationState();
	return shared ?? local;
}

/**
 * Tracks server-side filter navigations on pages whose queries are slow, so
 * every filter control can disable itself and the results show progress until
 * the new page data arrives.
 */
export function FilterNavigationProvider({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<FilterNavigationContext value={useFilterNavigationState()}>
			{children}
		</FilterNavigationContext>
	);
}

/**
 * Dims and blocks the results while a filter navigation is in flight. A null
 * `message` dims without the progress badge.
 */
export function FilterNavigationResults({
	children,
	message = "Loading…",
}: {
	children: ReactNode;
	message?: string | null;
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
			{isPending && message !== null && (
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

/**
 * In-page link (sort, pagination) that reports progress through the filter
 * navigation. New-tab clicks keep the native link behaviour.
 */
export function FilterLink({
	href,
	pendingKey,
	...props
}: Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & {
	href: string;
	pendingKey?: string;
}) {
	const { navigateTo } = useFilterNavigation();
	return (
		<Link
			href={href}
			{...props}
			onNavigate={(event) => {
				event.preventDefault();
				navigateTo(pendingKey ?? href, href);
			}}
		/>
	);
}
