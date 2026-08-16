import { Building2, Gauge, Globe, Tag } from "lucide-react";
import Link from "next/link";

import {
	DeleteDiscountButton,
	DeleteRoutingScoreMultiplierButton,
	DiscountForm,
	RoutingScoreMultiplierForm,
} from "@/components/discount-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	createGlobalDiscount,
	createRoutingScoreMultiplier,
	deleteGlobalDiscount,
	deleteRoutingScoreMultiplier,
	getAllOrganizationDiscounts,
	getDiscountOptions,
	getGlobalDiscounts,
	getRoutingScoreMultipliers,
} from "@/lib/admin-discounts";
import { requireSession } from "@/lib/require-session";

import type { ReactNode } from "react";

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function formatDiscount(decimalString: string): string {
	const decimal = parseFloat(decimalString);
	return `${(decimal * 100).toFixed(1)}%`;
}

function SignInPrompt() {
	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-md text-center">
				<div className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight">
						Admin Dashboard
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Sign in to access the admin dashboard
					</p>
				</div>
				<Button asChild size="lg" className="w-full">
					<Link href="/login">Sign In</Link>
				</Button>
			</div>
		</div>
	);
}

function ViewToggle({ active }: { active: "global" | "organizations" }) {
	return (
		<div className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card p-1">
			<Button
				asChild
				size="sm"
				variant={active === "global" ? "secondary" : "ghost"}
			>
				<Link href="/discounts">Global</Link>
			</Button>
			<Button
				asChild
				size="sm"
				variant={active === "organizations" ? "secondary" : "ghost"}
			>
				<Link href="/discounts?view=organizations">Organizations</Link>
			</Button>
		</div>
	);
}

function AdjustmentCells({
	entry,
	value,
}: {
	entry: {
		provider: string | null;
		model: string | null;
		reason: string | null;
		expiresAt: string | null;
		createdAt: string;
	};
	value: ReactNode;
}) {
	return (
		<>
			<TableCell>
				{entry.provider ? (
					<Badge variant="outline">{entry.provider}</Badge>
				) : (
					<span className="text-muted-foreground">All</span>
				)}
			</TableCell>
			<TableCell>
				{entry.model ? (
					<Badge variant="secondary">{entry.model}</Badge>
				) : (
					<span className="text-muted-foreground">All</span>
				)}
			</TableCell>
			<TableCell>{value}</TableCell>
			<TableCell className="max-w-[200px] truncate text-muted-foreground">
				{entry.reason ?? "—"}
			</TableCell>
			<TableCell className="text-muted-foreground">
				{entry.expiresAt ? (
					<span
						className={
							new Date(entry.expiresAt) < new Date() ? "text-destructive" : ""
						}
					>
						{formatDate(entry.expiresAt)}
					</span>
				) : (
					"Never"
				)}
			</TableCell>
			<TableCell className="text-muted-foreground">
				{formatDate(entry.createdAt)}
			</TableCell>
		</>
	);
}

function DiscountCells({
	discount,
}: {
	discount: Parameters<typeof AdjustmentCells>[0]["entry"] & {
		discountPercent: string;
	};
}) {
	return (
		<AdjustmentCells
			entry={discount}
			value={
				<span className="font-medium text-green-600">
					{formatDiscount(discount.discountPercent)} off
				</span>
			}
		/>
	);
}

async function OrganizationDiscountsView() {
	const discountsData = await getAllOrganizationDiscounts();

	if (discountsData === null) {
		return <SignInPrompt />;
	}

	const discounts = discountsData?.discounts ?? [];

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
				<div className="space-y-1">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<Building2 className="h-5 w-5" />
						</div>
						<div>
							<h1 className="text-2xl font-semibold tracking-tight">
								Discounts
							</h1>
							<p className="text-sm text-muted-foreground">
								Organizations with custom discounts
							</p>
						</div>
					</div>
				</div>
				<ViewToggle active="organizations" />
			</header>

			<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Organization</TableHead>
							<TableHead>Provider</TableHead>
							<TableHead>Model</TableHead>
							<TableHead>Discount</TableHead>
							<TableHead>Reason</TableHead>
							<TableHead>Expires</TableHead>
							<TableHead>Created</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{discounts.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={7}
									className="h-24 text-center text-muted-foreground"
								>
									<div className="flex flex-col items-center gap-2">
										<Tag className="h-8 w-8 text-muted-foreground/50" />
										<p>No organization-specific discounts configured</p>
										<p className="text-xs">
											Add discounts from an organization&apos;s page
										</p>
									</div>
								</TableCell>
							</TableRow>
						) : (
							discounts.map((discount) => (
								<TableRow key={discount.id}>
									<TableCell>
										{discount.organizationId ? (
											<Link
												href={`/organizations/${discount.organizationId}/discounts`}
												className="font-medium text-primary hover:underline"
											>
												{discount.organizationName ?? discount.organizationId}
											</Link>
										) : (
											<span className="text-muted-foreground">—</span>
										)}
									</TableCell>
									<DiscountCells discount={discount} />
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<div className="rounded-lg border border-border/60 bg-muted/30 p-4">
				<h3 className="text-sm font-medium">How organization discounts work</h3>
				<ul className="mt-2 space-y-1 text-sm text-muted-foreground">
					<li>Organization discounts take precedence over global discounts</li>
					<li>
						More specific discounts (provider + model) take precedence over
						broader ones
					</li>
					<li>Manage an organization&apos;s discounts from its detail page</li>
				</ul>
			</div>
		</div>
	);
}

export default async function DiscountsPage({
	searchParams,
}: {
	searchParams: Promise<{ view?: string }>;
}) {
	await requireSession();

	const { view } = await searchParams;

	if (view === "organizations") {
		return <OrganizationDiscountsView />;
	}

	const [discountsData, multipliersData, options] = await Promise.all([
		getGlobalDiscounts(),
		getRoutingScoreMultipliers(),
		getDiscountOptions(),
	]);

	if (discountsData === null) {
		return <SignInPrompt />;
	}

	const discounts = discountsData?.discounts ?? [];
	const multipliers = multipliersData?.multipliers ?? [];

	// Server action to create discount
	async function handleCreateDiscount(data: {
		provider: string | null;
		model: string | null;
		discountPercent: number;
		reason: string | null;
		expiresAt: string | null;
	}): Promise<{ success: boolean; error?: string }> {
		"use server";

		try {
			const result = await createGlobalDiscount({
				provider: data.provider,
				model: data.model,
				discountPercent: data.discountPercent,
				reason: data.reason,
				expiresAt: data.expiresAt,
			});

			if (!result) {
				return {
					success: false,
					error: "Failed to create discount. It may already exist.",
				};
			}

			return { success: true };
		} catch (error) {
			console.error("Error creating discount:", error);
			return {
				success: false,
				error: "An error occurred while creating the discount",
			};
		}
	}

	// Server action to delete discount
	async function handleDeleteDiscount(
		discountId: string,
	): Promise<{ success: boolean }> {
		"use server";

		const success = await deleteGlobalDiscount(discountId);
		return { success };
	}

	async function handleCreateRoutingScoreMultiplier(data: {
		provider: string | null;
		model: string | null;
		scoreMultiplier: number;
		reason: string | null;
		expiresAt: string | null;
	}): Promise<{ success: boolean; error?: string }> {
		"use server";

		try {
			const result = await createRoutingScoreMultiplier(data);
			return result
				? { success: true }
				: {
						success: false,
						error: "Failed to create multiplier. It may already exist.",
					};
		} catch (error) {
			console.error("Error creating routing score multiplier:", error);
			return {
				success: false,
				error: "An error occurred while creating the multiplier",
			};
		}
	}

	async function handleDeleteRoutingScoreMultiplier(
		multiplierId: string,
	): Promise<{ success: boolean }> {
		"use server";

		return {
			success: await deleteRoutingScoreMultiplier(multiplierId),
		};
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
				<div className="space-y-1">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<Globe className="h-5 w-5" />
						</div>
						<div>
							<h1 className="text-2xl font-semibold tracking-tight">
								Discounts
							</h1>
							<p className="text-sm text-muted-foreground">
								Global pricing and internal routing adjustments
							</p>
						</div>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<ViewToggle active="global" />
					{options && (
						<DiscountForm
							providers={options.providers}
							mappings={options.mappings}
							onSubmit={handleCreateDiscount}
						/>
					)}
				</div>
			</header>

			<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Provider</TableHead>
							<TableHead>Model</TableHead>
							<TableHead>Discount</TableHead>
							<TableHead>Reason</TableHead>
							<TableHead>Expires</TableHead>
							<TableHead>Created</TableHead>
							<TableHead className="w-[50px]" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{discounts.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={7}
									className="h-24 text-center text-muted-foreground"
								>
									<div className="flex flex-col items-center gap-2">
										<Tag className="h-8 w-8 text-muted-foreground/50" />
										<p>No global discounts configured</p>
										<p className="text-xs">
											Global discounts apply to all organizations
										</p>
									</div>
								</TableCell>
							</TableRow>
						) : (
							discounts.map((discount) => (
								<TableRow key={discount.id}>
									<DiscountCells discount={discount} />
									<TableCell>
										<DeleteDiscountButton
											discountId={discount.id}
											onDelete={handleDeleteDiscount}
										/>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<section className="space-y-3">
				<div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
					<div className="flex items-center gap-3">
						<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<Gauge className="h-4 w-4" />
						</div>
						<div>
							<h2 className="font-semibold">Routing score multipliers</h2>
							<p className="text-sm text-muted-foreground">
								Internal preference applied after customer discounts
							</p>
						</div>
					</div>
					{options && (
						<RoutingScoreMultiplierForm
							providers={options.providers}
							mappings={options.mappings}
							onSubmit={handleCreateRoutingScoreMultiplier}
						/>
					)}
				</div>

				<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Provider</TableHead>
								<TableHead>Model</TableHead>
								<TableHead>Adjustment</TableHead>
								<TableHead>Reason</TableHead>
								<TableHead>Expires</TableHead>
								<TableHead>Created</TableHead>
								<TableHead className="w-[50px]" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{multipliers.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={7}
										className="h-24 text-center text-muted-foreground"
									>
										<div className="flex flex-col items-center gap-2">
											<Gauge className="h-8 w-8 text-muted-foreground/50" />
											<p>No routing score multipliers configured</p>
											<p className="text-xs">
												Negative values prefer a target; positive values
												penalize it
											</p>
										</div>
									</TableCell>
								</TableRow>
							) : (
								multipliers.map((multiplier) => {
									const percent = Number(multiplier.scoreMultiplier) * 100;
									return (
										<TableRow key={multiplier.id}>
											<AdjustmentCells
												entry={multiplier}
												value={
													<span
														className={
															percent < 0
																? "font-medium text-green-600"
																: "font-medium text-amber-600"
														}
													>
														{percent > 0 ? "+" : ""}
														{percent.toFixed(1)}%
													</span>
												}
											/>
											<TableCell>
												<DeleteRoutingScoreMultiplierButton
													multiplierId={multiplier.id}
													onDelete={handleDeleteRoutingScoreMultiplier}
												/>
											</TableCell>
										</TableRow>
									);
								})
							)}
						</TableBody>
					</Table>
				</div>
			</section>

			<div className="rounded-lg border border-border/60 bg-muted/30 p-4">
				<h3 className="text-sm font-medium">How global discounts work</h3>
				<ul className="mt-2 space-y-1 text-sm text-muted-foreground">
					<li>
						Global discounts apply to ALL organizations unless overridden by
						org-specific discounts
					</li>
					<li>They are applied automatically to API usage</li>
					<li>
						More specific discounts (provider + model) take precedence over
						broader ones
					</li>
					<li>
						A 30% discount means all customers pay 70% of the original price
					</li>
				</ul>
			</div>
		</div>
	);
}
