"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ListFilter, Loader2, Plus, Trash2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useApi } from "@/lib/fetch-client";

export function IgnoredErrorsToggle({
	ignoreExpected,
}: {
	ignoreExpected: boolean;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const handleSelect = useCallback(
		(value: boolean) => {
			const params = new URLSearchParams(searchParams.toString());
			if (value) {
				params.delete("ignoreExpected");
			} else {
				params.set("ignoreExpected", "false");
			}
			router.push(`${pathname}?${params.toString()}`);
		},
		[router, pathname, searchParams],
	);

	return (
		<div className="flex items-center gap-1">
			<Button
				variant={ignoreExpected ? "default" : "outline"}
				size="sm"
				onClick={() => handleSelect(true)}
			>
				Ignore expected
			</Button>
			<Button
				variant={ignoreExpected ? "outline" : "default"}
				size="sm"
				onClick={() => handleSelect(false)}
			>
				Show all errors
			</Button>
		</div>
	);
}

export function IgnoredErrorMatchersDialog({
	matcherCount,
}: {
	matcherCount: number;
}) {
	const $api = useApi();
	const queryClient = useQueryClient();
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [pattern, setPattern] = useState("");
	const [statusCode, setStatusCode] = useState("");
	const [error, setError] = useState<string | null>(null);

	const { data, isLoading } = $api.useQuery(
		"get",
		"/admin/unstable-mappings/ignored-errors",
		{},
		{ enabled: open },
	);

	const invalidate = () => {
		void queryClient.invalidateQueries({
			queryKey: $api.queryOptions(
				"get",
				"/admin/unstable-mappings/ignored-errors",
			).queryKey,
		});
		router.refresh();
	};

	const createMutation = $api.useMutation(
		"post",
		"/admin/unstable-mappings/ignored-errors",
		{
			onSuccess: () => {
				setPattern("");
				setStatusCode("");
				setError(null);
				invalidate();
			},
			onError: () => {
				setError("Failed to add matcher. It may already exist.");
			},
		},
	);

	const deleteMutation = $api.useMutation(
		"delete",
		"/admin/unstable-mappings/ignored-errors/{id}",
		{
			onSuccess: () => {
				invalidate();
			},
		},
	);

	const trimmedPattern = pattern.trim();
	const trimmedStatusCode = statusCode.trim();
	const parsedStatusCode = trimmedStatusCode ? Number(trimmedStatusCode) : null;
	const statusCodeInvalid =
		parsedStatusCode !== null &&
		(!Number.isInteger(parsedStatusCode) ||
			parsedStatusCode < 100 ||
			parsedStatusCode > 599);
	const canAdd =
		(trimmedPattern.length > 0 || parsedStatusCode !== null) &&
		!statusCodeInvalid;

	const handleAdd = (e: React.FormEvent) => {
		e.preventDefault();
		if (!canAdd) {
			return;
		}
		setError(null);
		createMutation.mutate({
			body: {
				pattern: trimmedPattern || null,
				statusCode: parsedStatusCode,
			},
		});
	};

	const matchers = data?.matchers ?? [];

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setError(null);
				}
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<ListFilter className="h-4 w-4" />
					Ignored errors ({matcherCount})
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Ignored error matchers</DialogTitle>
					<DialogDescription>
						Errors matching one of these matchers are treated as expected
						upstream errors and do not count against a mapping&apos;s error
						rate. Match by a case-insensitive substring of the error details, an
						upstream status code, or both.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleAdd} className="flex items-center gap-2">
					<Input
						value={pattern}
						onChange={(e) => setPattern(e.target.value)}
						placeholder="Substring, e.g. overloaded_error"
						maxLength={500}
					/>
					<Input
						value={statusCode}
						onChange={(e) => setStatusCode(e.target.value)}
						placeholder="Status"
						inputMode="numeric"
						className="w-20 shrink-0"
						aria-label="Upstream status code"
						aria-invalid={statusCodeInvalid}
					/>
					<Button
						type="submit"
						size="sm"
						disabled={createMutation.isPending || !canAdd}
					>
						{createMutation.isPending ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Plus className="h-4 w-4" />
						)}
						Add
					</Button>
				</form>

				{error && (
					<p className="text-sm text-destructive" role="alert">
						{error}
					</p>
				)}

				{isLoading ? (
					<div className="space-y-2">
						{[0, 1, 2].map((i) => (
							<div key={i} className="h-9 animate-pulse rounded bg-muted/40" />
						))}
					</div>
				) : matchers.length === 0 ? (
					<p className="py-2 text-sm text-muted-foreground">
						No ignored error matchers yet.
					</p>
				) : (
					<ul className="max-h-80 space-y-1 overflow-y-auto">
						{matchers.map((matcher) => (
							<li
								key={matcher.id}
								className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-1.5"
							>
								<span className="flex min-w-0 items-center gap-2">
									{matcher.statusCode !== null && (
										<Badge variant="outline" className="shrink-0 font-mono">
											{matcher.statusCode}
										</Badge>
									)}
									{matcher.pattern !== null && (
										<code className="break-all font-mono text-xs">
											{matcher.pattern}
										</code>
									)}
								</span>
								<Button
									variant="ghost"
									size="icon-sm"
									className="shrink-0 text-destructive hover:text-destructive"
									aria-label={`Remove matcher ${matcher.pattern ?? matcher.statusCode}`}
									disabled={deleteMutation.isPending}
									onClick={() =>
										deleteMutation.mutate({
											params: { path: { id: matcher.id } },
										})
									}
								>
									<Trash2 className="h-4 w-4" />
								</Button>
							</li>
						))}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
}
