import { Globe, Tag } from "lucide-react";
import Link from "next/link";

import { DeleteDiscountButton, DiscountForm } from "@/components/discount-form";
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
	deleteGlobalDiscount,
	getDiscountOptions,
	getGlobalDiscounts,
} from "@/lib/admin-discounts";

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

export default async function GlobalDiscountsPage() {
	const [discountsData, options] = await Promise.all([
		getGlobalDiscounts(),
		getDiscountOptions(),
	]);

	if (discountsData === null) {
		return <SignInPrompt />;
	}

	const discounts = discountsData?.discounts ?? [];

	// Server action to create discount
	async function handleCreateDiscount(data: {
		provider: string | null;
		model: string | null;
		discountPercent: number;
		reason: string | null;
	}): Promise<{ success: boolean; error?: string }> {
		"use server";

		try {
			const result = await createGlobalDiscount({
				provider: data.provider,
				model: data.model,
				discountPercent: data.discountPercent,
				reason: data.reason,
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

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
				<div className="space-y-1">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<Globe className="h-5 w-5" />
						</div>
						<div>
							<h1 className="text-2xl font-semibold tracking-tight">
								Global Discounts
							</h1>
							<p className="text-sm text-muted-foreground">
								Discounts that apply to all organizations
							</p>
						</div>
					</div>
				</div>
				{options && (
					<DiscountForm
						providers={options.providers}
						mappings={options.mappings}
						onSubmit={handleCreateDiscount}
					/>
				)}
			</header>

			<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Provider</TableHead>
							<TableHead>Model</TableHead>
							<TableHead>Discount</TableHead>
							<TableHead>Reason</TableHead>
							<TableHead>Created</TableHead>
							<TableHead className="w-[50px]" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{discounts.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={6}
									className="h-24 text-center text-muted-foreground"
								>
									<div className="flex flex-col items-center gap-2">
										<Tag className="h-8 w-8 text-muted-foreground/50" />
										<p>No global discounts configured</p>
										<p className="text-xs">
											Global discounts apply to all organizations and override
											hardcoded model discounts
										</p>
									</div>
								</TableCell>
							</TableRow>
						) : (
							discounts.map((discount) => (
								<TableRow key={discount.id}>
									<TableCell>
										{discount.provider ? (
											<Badge variant="outline">{discount.provider}</Badge>
										) : (
											<span className="text-muted-foreground">All</span>
										)}
									</TableCell>
									<TableCell>
										{discount.model ? (
											<Badge variant="secondary">{discount.model}</Badge>
										) : (
											<span className="text-muted-foreground">All</span>
										)}
									</TableCell>
									<TableCell>
										<span className="font-medium text-green-600">
											{formatDiscount(discount.discountPercent)} off
										</span>
									</TableCell>
									<TableCell className="max-w-[200px] truncate text-muted-foreground">
										{discount.reason ?? "—"}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatDate(discount.createdAt)}
									</TableCell>
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

			<div className="rounded-lg border border-border/60 bg-muted/30 p-4">
				<h3 className="text-sm font-medium">How global discounts work</h3>
				<ul className="mt-2 space-y-1 text-sm text-muted-foreground">
					<li>
						Global discounts apply to ALL organizations unless overridden by
						org-specific discounts
					</li>
					<li>
						They take precedence over hardcoded model discounts in the codebase
					</li>
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
