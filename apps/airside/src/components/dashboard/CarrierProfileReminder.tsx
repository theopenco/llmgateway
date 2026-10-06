"use client";

import { Bell, FileWarning, ScrollText, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";

import {
	joinList,
	profileFieldLabel,
} from "@/components/brand/carrier-profile";
import { useCompany } from "@/components/dashboard/company-context";
import { useInvalidateCompanies } from "@/components/dashboard/useInvalidateCompanies";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

export interface AirsideNotification {
	id: string;
	priority: "required" | "recommended";
	kind: "profile" | "terms";
	title: string;
	description: string;
	href?: string;
	companyId: string;
}

export function brandHref(providerId: string) {
	return `/dashboard/brand?carrier=${encodeURIComponent(providerId)}`;
}

export function useAirsideNotifications() {
	const { company } = useCompany();

	return useMemo(() => {
		const items: AirsideNotification[] = [];
		if (!company) {
			return { items, required: items, recommended: items, brandCount: 0 };
		}
		if (!company.termsAcceptedAt) {
			items.push({
				id: `terms:${company.id}`,
				priority: "required",
				kind: "terms",
				title: "Accept the Airside Terms of Use",
				description:
					"Agree to the Airside Terms of Use and Privacy Notice to keep operating your carriers.",
				companyId: company.id,
			});
		}
		const claims = company.claims.filter(
			(claim) => claim.status === "pending" || claim.status === "active",
		);
		for (const claim of claims) {
			if (claim.profileMissing.length > 0) {
				items.push({
					id: `profile:${claim.id}:${claim.profileMissing.join(",")}`,
					priority: "required",
					kind: "profile",
					title: `${claim.providerName} is missing its ${joinList(
						claim.profileMissing.map(profileFieldLabel),
					)}`,
					description:
						"Developers see these links on your public provider page. Add them in Brand & profile.",
					href: brandHref(claim.providerId),
					companyId: company.id,
				});
			}
		}
		for (const claim of claims) {
			if (claim.profileRecommendedMissing.length > 0) {
				const count = claim.profileRecommendedMissing.length;
				items.push({
					id: `recommended:${claim.id}`,
					priority: "recommended",
					kind: "profile",
					title: `Complete ${claim.providerName}'s public profile`,
					description: `${count} recommended detail${count === 1 ? "" : "s"} not stated: ${joinList(
						claim.profileRecommendedMissing.slice(0, 4).map(profileFieldLabel),
					)}${count > 4 ? "…" : ""}.`,
					href: brandHref(claim.providerId),
					companyId: company.id,
				});
			}
		}
		const required = items.filter((item) => item.priority === "required");
		const recommended = items.filter((item) => item.priority === "recommended");
		return {
			items,
			required,
			recommended,
			brandCount: required.filter((item) => item.kind === "profile").length,
		};
	}, [company]);
}

function useAcceptTerms() {
	const api = useApi();
	const invalidate = useInvalidateCompanies();
	return api.useMutation("post", "/airside/companies/{id}/accept-terms", {
		onSuccess: async () => {
			await invalidate();
			toast.success("Thanks — terms accepted.");
		},
		onError: (error) => {
			toast.error(
				(error as { message?: string })?.message ??
					"Failed to record your acceptance",
			);
		},
	});
}

function TermsLinks() {
	return (
		<>
			<Link href="/legal/terms" className="underline underline-offset-2">
				Terms of Use
			</Link>{" "}
			and{" "}
			<Link href="/legal/privacy" className="underline underline-offset-2">
				Privacy Notice
			</Link>
		</>
	);
}

const DISMISS_KEY = "airside:profile-reminder-dismissed";
const DISMISS_EVENT = "airside:profile-reminder-dismissed";

function subscribeDismissed(callback: () => void) {
	window.addEventListener(DISMISS_EVENT, callback);
	window.addEventListener("storage", callback);
	return () => {
		window.removeEventListener(DISMISS_EVENT, callback);
		window.removeEventListener("storage", callback);
	};
}

function readDismissed(): string | null {
	try {
		return window.sessionStorage.getItem(DISMISS_KEY);
	} catch {
		return null;
	}
}

function dismiss(signature: string) {
	try {
		window.sessionStorage.setItem(DISMISS_KEY, signature);
	} catch {
		// Storage can be unavailable (private mode); dismissal then lasts until reload.
	}
	window.dispatchEvent(new Event(DISMISS_EVENT));
}

export function CarrierProfileBanner() {
	const { required } = useAirsideNotifications();
	const acceptTerms = useAcceptTerms();
	const dismissed = useSyncExternalStore(
		subscribeDismissed,
		readDismissed,
		() => null,
	);
	const signature = required.map((item) => item.id).join("|");

	if (required.length === 0 || dismissed === signature) {
		return null;
	}

	return (
		<div
			role="status"
			aria-live="polite"
			data-testid="profile-reminder-banner"
			className="border-destructive/40 bg-destructive/5 relative rounded-lg border px-4 py-3 pr-11"
		>
			<div className="flex items-start gap-3">
				<FileWarning
					className="text-destructive mt-0.5 size-4 shrink-0"
					aria-hidden
				/>
				<ul className="min-w-0 flex-1 space-y-2">
					{required.slice(0, 3).map((item) => (
						<li
							key={item.id}
							className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
						>
							<div className="min-w-0">
								<p className="text-sm font-semibold">{item.title}</p>
								<p className="text-muted-foreground text-xs">
									{item.kind === "terms" ? (
										<>
											Agree to the Airside <TermsLinks /> to keep operating your
											carriers.
										</>
									) : (
										item.description
									)}
								</p>
							</div>
							{item.kind === "terms" ? (
								<Button
									size="sm"
									className="font-semibold"
									disabled={acceptTerms.isPending}
									data-testid="banner-accept-terms"
									onClick={() =>
										acceptTerms.mutate({
											params: { path: { id: item.companyId } },
										})
									}
								>
									{acceptTerms.isPending ? "Accepting…" : "Accept terms"}
								</Button>
							) : item.href ? (
								<Button
									asChild
									size="sm"
									variant="outline"
									className="font-semibold"
								>
									<Link href={item.href}>Add profile links</Link>
								</Button>
							) : null}
						</li>
					))}
					{required.length > 3 ? (
						<li className="text-muted-foreground text-xs">
							+{required.length - 3} more in notifications.
						</li>
					) : null}
				</ul>
			</div>
			<Button
				type="button"
				size="icon-sm"
				variant="ghost"
				className="absolute top-2 right-2"
				aria-label="Dismiss reminder for this session"
				onClick={() => dismiss(signature)}
			>
				<X aria-hidden />
			</Button>
		</div>
	);
}

export function NotificationsBell() {
	const { items, required } = useAirsideNotifications();
	const acceptTerms = useAcceptTerms();
	const count = items.length;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					className="relative"
					aria-label={
						count === 0
							? "Notifications, none"
							: `Notifications, ${count} unread`
					}
					data-testid="notifications-bell"
				>
					<Bell aria-hidden />
					{count > 0 ? (
						<span
							aria-hidden
							data-testid="notifications-count"
							className={cn(
								"absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[0.6rem] font-bold",
								required.length > 0
									? "bg-destructive text-white"
									: "bg-primary text-primary-foreground",
							)}
						>
							{count > 9 ? "9+" : count}
						</span>
					) : null}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="w-80 p-0"
				data-testid="notifications-menu"
			>
				<DropdownMenuLabel className="flex items-center justify-between px-3 py-2">
					<span className="font-display text-sm font-bold">Notifications</span>
					{count > 0 ? (
						<span className="text-muted-foreground font-mono text-[0.65rem] tracking-wider uppercase">
							{count} open
						</span>
					) : null}
				</DropdownMenuLabel>
				<DropdownMenuSeparator className="my-0" />
				{count === 0 ? (
					<p className="text-muted-foreground px-3 py-6 text-center text-sm">
						You&apos;re all caught up.
					</p>
				) : (
					<div className="max-h-96 overflow-y-auto p-1">
						{items.map((item) =>
							item.kind === "terms" ? (
								<div key={item.id} className="border-b pb-1 last:border-b-0">
									<div className="flex gap-3 px-2 pt-2 pb-1">
										<ScrollText
											className="text-destructive mt-0.5 size-4 shrink-0"
											aria-hidden
										/>
										<div className="min-w-0 space-y-0.5">
											<p className="text-sm leading-snug font-medium">
												{item.title}
											</p>
											<p className="text-muted-foreground text-xs">
												{item.description}
											</p>
										</div>
									</div>
									<div className="flex gap-1 pl-7">
										<DropdownMenuItem
											disabled={acceptTerms.isPending}
											className="text-primary font-semibold"
											data-testid="bell-accept-terms"
											onSelect={(event) => {
												event.preventDefault();
												acceptTerms.mutate({
													params: { path: { id: item.companyId } },
												});
											}}
										>
											{acceptTerms.isPending ? "Accepting…" : "Accept terms"}
										</DropdownMenuItem>
										<DropdownMenuItem asChild>
											<Link href="/legal/terms">Read terms</Link>
										</DropdownMenuItem>
									</div>
								</div>
							) : (
								<DropdownMenuItem
									key={item.id}
									asChild
									className="items-start gap-3 py-2"
								>
									<Link href={item.href ?? "/dashboard/brand"}>
										<span
											aria-hidden
											className={cn(
												"mt-1.5 size-2 shrink-0 rounded-full",
												item.priority === "required"
													? "bg-destructive"
													: "bg-muted-foreground/40",
											)}
										/>
										<span className="min-w-0 space-y-0.5">
											<span className="block text-sm leading-snug font-medium">
												{item.title}
											</span>
											<span className="text-muted-foreground block text-xs">
												{item.priority === "required"
													? item.description
													: `Recommended · ${item.description}`}
											</span>
										</span>
									</Link>
								</DropdownMenuItem>
							),
						)}
					</div>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
