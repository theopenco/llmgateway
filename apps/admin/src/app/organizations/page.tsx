import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

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
import { getOrganizations } from "@/lib/admin-organizations";

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function getPlanBadgeVariant(plan: string) {
	switch (plan) {
		case "enterprise":
			return "default";
		case "pro":
			return "secondary";
		default:
			return "outline";
	}
}

function getDevPlanBadgeVariant(devPlan: string) {
	switch (devPlan) {
		case "max":
			return "default";
		case "pro":
			return "secondary";
		case "lite":
			return "outline";
		default:
			return "outline";
	}
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

export default async function OrganizationsPage({
	searchParams,
}: {
	searchParams?: Promise<{ page?: string; search?: string }>;
}) {
	const params = await searchParams;
	const page = Math.max(1, parseInt(params?.page || "1", 10));
	const search = params?.search || "";
	const limit = 25;
	const offset = (page - 1) * limit;

	const data = await getOrganizations({ limit, offset, search });

	if (!data) {
		return <SignInPrompt />;
	}

	const totalPages = Math.ceil(data.total / limit);

	async function handleSearch(formData: FormData) {
		"use server";
		const searchValue = formData.get("search") as string;
		const searchParam = searchValue
			? `&search=${encodeURIComponent(searchValue)}`
			: "";
		redirect(`/organizations?page=1${searchParam}`);
	}

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">
						Organizations
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{data.total} organizations found
					</p>
				</div>
				<form action={handleSearch} className="flex items-center gap-2">
					<div className="relative">
						<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							type="text"
							name="search"
							placeholder="Search by name, email, or ID..."
							defaultValue={search}
							className="h-9 w-64 rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</div>
					<Button type="submit" size="sm">
						Search
					</Button>
				</form>
			</header>

			<div className="rounded-lg border border-border/60 bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Organization</TableHead>
							<TableHead>Email</TableHead>
							<TableHead>Plan</TableHead>
							<TableHead>Dev Plan</TableHead>
							<TableHead>Credits</TableHead>
							<TableHead>Created</TableHead>
							<TableHead>Status</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.organizations.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={7}
									className="h-24 text-center text-muted-foreground"
								>
									No organizations found
								</TableCell>
							</TableRow>
						) : (
							data.organizations.map((org) => (
								<TableRow key={org.id}>
									<TableCell>
										<Link
											href={`/organizations/${org.id}`}
											className="font-medium text-foreground hover:underline"
										>
											{org.name}
										</Link>
										<p className="text-xs text-muted-foreground">{org.id}</p>
									</TableCell>
									<TableCell className="text-muted-foreground">
										{org.billingEmail}
									</TableCell>
									<TableCell>
										<Badge variant={getPlanBadgeVariant(org.plan)}>
											{org.plan}
										</Badge>
									</TableCell>
									<TableCell>
										{org.devPlan !== "none" ? (
											<Badge variant={getDevPlanBadgeVariant(org.devPlan)}>
												{org.devPlan}
											</Badge>
										) : (
											<span className="text-muted-foreground">—</span>
										)}
									</TableCell>
									<TableCell className="tabular-nums">
										{currencyFormatter.format(parseFloat(org.credits))}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatDate(org.createdAt)}
									</TableCell>
									<TableCell>
										<Badge
											variant={
												org.status === "active" ? "secondary" : "outline"
											}
										>
											{org.status || "active"}
										</Badge>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{totalPages > 1 && (
				<div className="flex items-center justify-between">
					<p className="text-sm text-muted-foreground">
						Showing {offset + 1} to {Math.min(offset + limit, data.total)} of{" "}
						{data.total}
					</p>
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" asChild disabled={page <= 1}>
							<Link
								href={`/organizations?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
								className={page <= 1 ? "pointer-events-none opacity-50" : ""}
							>
								<ChevronLeft className="h-4 w-4" />
								Previous
							</Link>
						</Button>
						<span className="text-sm text-muted-foreground">
							Page {page} of {totalPages}
						</span>
						<Button
							variant="outline"
							size="sm"
							asChild
							disabled={page >= totalPages}
						>
							<Link
								href={`/organizations?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
								className={
									page >= totalPages ? "pointer-events-none opacity-50" : ""
								}
							>
								Next
								<ChevronRight className="h-4 w-4" />
							</Link>
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
