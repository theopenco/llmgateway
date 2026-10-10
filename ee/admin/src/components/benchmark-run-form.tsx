"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useApi } from "@/lib/fetch-client";

import type { BenchmarkModelOption, BenchmarkProfileOption } from "@/lib/types";

function SourceBadge({ source }: { source: "catalogue" | "airside" }) {
	if (source !== "airside") {
		return null;
	}
	return (
		<span className="rounded-sm bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
			Airside
		</span>
	);
}

export function BenchmarkRunForm({
	models,
	profiles,
	gatewayKeyConfigured,
}: {
	models: BenchmarkModelOption[];
	profiles: BenchmarkProfileOption[];
	gatewayKeyConfigured: boolean;
}) {
	const $api = useApi();
	const router = useRouter();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [modelId, setModelId] = useState("");
	const [selected, setSelected] = useState<string[]>([]);
	const [profile, setProfile] = useState("smoke");
	const [budgetSeconds, setBudgetSeconds] = useState("120");

	const model = useMemo(
		() => models.find((candidate) => candidate.modelId === modelId) ?? null,
		[modelId, models],
	);
	const availableMappings = useMemo(
		() => model?.mappings.filter((mapping) => !mapping.deactivated) ?? [],
		[model],
	);

	const createMutation = $api.useMutation("post", "/admin/benchmarks/runs", {
		onSuccess: () => {
			setOpen(false);
			setModelId("");
			setSelected([]);
			void queryClient.invalidateQueries({
				queryKey: $api.queryOptions("get", "/admin/benchmarks/runs", {})
					.queryKey,
			});
			router.refresh();
		},
		onError: () => {
			setError("Failed to queue the benchmark run.");
		},
	});

	const handleModelChange = (value: string) => {
		setModelId(value);
		setSelected([]);
		setError(null);
	};

	const toggleMapping = (mapping: string, checked: boolean) => {
		setSelected((current) =>
			checked
				? [...current, mapping]
				: current.filter((entry) => entry !== mapping),
		);
	};

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		const seconds = Number(budgetSeconds);
		if (!Number.isFinite(seconds) || seconds < 10 || seconds > 1800) {
			setError("Budget per target must be between 10 and 1800 seconds.");
			return;
		}
		createMutation.mutate({
			body: {
				modelId,
				// An empty selection means every active mapping of the model.
				mappings: selected,
				profile: profile as BenchmarkProfileOption["name"],
				budgetMs: Math.round(seconds * 1000),
				timeoutMs: 120_000,
				seed: 1,
			},
		});
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button disabled={!gatewayKeyConfigured}>
					<Play className="mr-2 h-4 w-4" />
					New run
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Queue a benchmark run</DialogTitle>
					<DialogDescription>
						The worker runs this against the live gateway and bills real
						upstream calls. Airside listings are benchmarkable alongside
						catalogue models.
					</DialogDescription>
				</DialogHeader>
				<form className="space-y-4" onSubmit={handleSubmit}>
					<div className="space-y-2">
						<Label htmlFor="benchmark-model">Model</Label>
						<Select value={modelId} onValueChange={handleModelChange}>
							<SelectTrigger id="benchmark-model">
								<SelectValue placeholder="Select a model" />
							</SelectTrigger>
							<SelectContent>
								{models.map((option) => (
									<SelectItem key={option.modelId} value={option.modelId}>
										<span className="flex items-center gap-2">
											{option.modelName}
											<SourceBadge source={option.source} />
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{model ? (
						<div className="space-y-2">
							<Label>
								Mappings{" "}
								<span className="font-normal text-muted-foreground">
									(none selected runs all {availableMappings.length})
								</span>
							</Label>
							<div className="max-h-52 space-y-2 overflow-y-auto rounded-md border p-3">
								{availableMappings.map((mapping) => (
									<label
										key={mapping.mapping}
										className="flex items-center gap-2 text-sm"
									>
										<Checkbox
											checked={selected.includes(mapping.mapping)}
											onCheckedChange={(checked) =>
												toggleMapping(mapping.mapping, checked === true)
											}
										/>
										<span className="flex items-center gap-2">
											{mapping.mapping}
											<SourceBadge source={mapping.source} />
										</span>
									</label>
								))}
							</div>
						</div>
					) : null}

					<div className="space-y-2">
						<Label htmlFor="benchmark-profile">Profile</Label>
						<Select value={profile} onValueChange={setProfile}>
							<SelectTrigger id="benchmark-profile">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{profiles.map((option) => (
									<SelectItem key={option.name} value={option.name}>
										{option.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							{profiles.find((option) => option.name === profile)?.description}
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="benchmark-budget">
							Budget per target (seconds)
						</Label>
						<Input
							id="benchmark-budget"
							value={budgetSeconds}
							onChange={(event) => setBudgetSeconds(event.target.value)}
							inputMode="numeric"
						/>
					</div>

					{error ? <p className="text-sm text-destructive">{error}</p> : null}

					<DialogFooter>
						<Button
							type="submit"
							disabled={!modelId || createMutation.isPending}
						>
							{createMutation.isPending ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : null}
							Queue run
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
