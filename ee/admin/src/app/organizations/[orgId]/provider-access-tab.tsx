"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { canWrite } from "@/lib/admin-role";
import { useAdminRole } from "@/lib/admin-role-context";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

type ProviderAccessResponse =
	paths["/admin/organizations/{orgId}/provider-access"]["get"]["responses"]["200"]["content"]["application/json"];

type Restriction = NonNullable<ProviderAccessResponse["restriction"]>;

type Mode = Restriction["mode"] | "none";

interface Option {
	value: string;
	label: string;
	hint?: string;
}

const MAX_VISIBLE_OPTIONS = 100;

const MODE_DESCRIPTIONS: Record<Mode, string> = {
	none: "The organization can use every provider and model.",
	deny: "Requests to any listed provider, model or mapping are rejected; everything else stays available.",
	allow:
		"Only listed providers, models and mappings are served; everything else is rejected. Entries are combined, so a provider allows all of its models. The organization's own custom providers count as the custom provider.",
};

function MultiSelect({
	label,
	placeholder,
	options,
	selected,
	onChange,
	disabled,
}: {
	label: string;
	placeholder: string;
	options: Option[];
	selected: string[];
	onChange: (next: string[]) => void;
	disabled: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const labels = useMemo(
		() => new Map(options.map((option) => [option.value, option.label])),
		[options],
	);
	const filtered = useMemo(() => {
		const query = search.trim().toLowerCase();
		const matches = query
			? options.filter(
					(option) =>
						option.value.toLowerCase().includes(query) ||
						option.label.toLowerCase().includes(query),
				)
			: options;
		return {
			visible: matches.slice(0, MAX_VISIBLE_OPTIONS),
			hidden: Math.max(0, matches.length - MAX_VISIBLE_OPTIONS),
		};
	}, [options, search]);

	const toggle = (value: string) => {
		onChange(
			selected.includes(value)
				? selected.filter((entry) => entry !== value)
				: [...selected, value],
		);
	};

	return (
		<div className="space-y-2">
			<Label>
				{label}{" "}
				<span className="text-muted-foreground">({selected.length})</span>
			</Label>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						role="combobox"
						aria-label={label}
						aria-expanded={open}
						className="w-full justify-between font-normal"
						disabled={disabled}
					>
						<span className="text-muted-foreground">{placeholder}</span>
						<ChevronsUpDown className="h-4 w-4 opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-[420px] p-0" align="start">
					<Command shouldFilter={false}>
						<CommandInput
							placeholder="Search…"
							value={search}
							onValueChange={setSearch}
						/>
						<CommandList>
							<CommandEmpty>No matches.</CommandEmpty>
							<CommandGroup>
								{filtered.visible.map((option) => (
									<CommandItem
										key={option.value}
										value={option.value}
										onSelect={() => toggle(option.value)}
									>
										<Check
											className={
												selected.includes(option.value)
													? "mr-2 h-4 w-4"
													: "mr-2 h-4 w-4 opacity-0"
											}
										/>
										<span className="truncate">{option.label}</span>
										{option.hint && (
											<span className="ml-auto truncate pl-2 font-mono text-xs text-muted-foreground">
												{option.hint}
											</span>
										)}
									</CommandItem>
								))}
							</CommandGroup>
							{filtered.hidden > 0 && (
								<p className="px-3 py-2 text-xs text-muted-foreground">
									{filtered.hidden} more — refine the search to see them.
								</p>
							)}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
			{selected.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{selected.map((value) => (
						<Badge key={value} variant="secondary" className="gap-1">
							<span className="font-mono text-xs">{value}</span>
							{labels.get(value) && labels.get(value) !== value && (
								<span className="text-muted-foreground">
									{labels.get(value)}
								</span>
							)}
							{!disabled && (
								<button
									type="button"
									aria-label={`Remove ${value}`}
									onClick={() => toggle(value)}
									className="rounded-sm hover:text-destructive"
								>
									<X className="h-3 w-3" />
								</button>
							)}
						</Badge>
					))}
				</div>
			)}
		</div>
	);
}

function ProviderAccessForm({
	orgId,
	data,
	readOnly,
}: {
	orgId: string;
	data: ProviderAccessResponse;
	readOnly: boolean;
}) {
	const $api = useApi();
	const queryClient = useQueryClient();
	const initial = data.restriction;
	const [mode, setMode] = useState<Mode>(initial?.mode ?? "none");
	const [providers, setProviders] = useState(initial?.providers ?? []);
	const [models, setModels] = useState(initial?.models ?? []);
	const [mappings, setMappings] = useState(initial?.mappings ?? []);
	const [note, setNote] = useState(initial?.note ?? "");

	const providerOptions = useMemo<Option[]>(
		() =>
			data.options.providers.map((provider) => ({
				value: provider.id,
				label: provider.name,
				hint: provider.id,
			})),
		[data.options.providers],
	);
	const modelOptions = useMemo<Option[]>(
		() =>
			data.options.models.map((model) => ({
				value: model.id,
				label: model.name,
				hint: model.id,
			})),
		[data.options.models],
	);
	const mappingOptions = useMemo<Option[]>(
		() =>
			data.options.mappings.map((mapping) => {
				const ref = `${mapping.providerId}/${mapping.modelId}`;
				return { value: ref, label: ref };
			}),
		[data.options.mappings],
	);

	const saveMutation = $api.useMutation(
		"put",
		"/admin/organizations/{orgId}/provider-access",
		{
			meta: { inlineError: true },
			onSuccess: () => {
				toast.success("Provider access updated");
				void queryClient.invalidateQueries({
					queryKey: $api.queryOptions(
						"get",
						"/admin/organizations/{orgId}/provider-access",
						{ params: { path: { orgId } } },
					).queryKey,
				});
			},
		},
	);
	const error = saveMutation.isError
		? apiErrorMessage(saveMutation.error, "Failed to update provider access")
		: null;

	const entryCount = providers.length + models.length + mappings.length;
	const canSave = !readOnly && (mode === "none" || entryCount > 0);

	const save = () => {
		saveMutation.mutate({
			params: { path: { orgId } },
			body: {
				restriction:
					mode === "none"
						? null
						: {
								mode,
								providers,
								models,
								mappings,
								...(note.trim() ? { note: note.trim() } : {}),
							},
			},
		});
	};

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<Label htmlFor="provider-access-mode">Mode</Label>
				<Select
					value={mode}
					onValueChange={(value) => setMode(value as Mode)}
					disabled={readOnly}
				>
					<SelectTrigger id="provider-access-mode" className="w-full sm:w-80">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="none">No restriction</SelectItem>
						<SelectItem value="deny">Deny list</SelectItem>
						<SelectItem value="allow">Allow list</SelectItem>
					</SelectContent>
				</Select>
				<p className="text-sm text-muted-foreground">
					{MODE_DESCRIPTIONS[mode]}
					{mode === "none" &&
						initial &&
						" Saving removes the current restriction."}
				</p>
			</div>

			{mode !== "none" && (
				<>
					<div className="grid gap-6 lg:grid-cols-3">
						<MultiSelect
							label="Providers"
							placeholder="Select providers"
							options={providerOptions}
							selected={providers}
							onChange={setProviders}
							disabled={readOnly}
						/>
						<MultiSelect
							label="Models"
							placeholder="Select models"
							options={modelOptions}
							selected={models}
							onChange={setModels}
							disabled={readOnly}
						/>
						<MultiSelect
							label="Model mappings"
							placeholder="Select provider/model pairs"
							options={mappingOptions}
							selected={mappings}
							onChange={setMappings}
							disabled={readOnly}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="provider-access-note">Reason</Label>
						<Textarea
							id="provider-access-note"
							value={note}
							onChange={(event) => setNote(event.target.value)}
							placeholder="Why this restriction exists (visible in the organization's audit log)"
							maxLength={1000}
							disabled={readOnly}
						/>
					</div>
					{mode === "allow" && entryCount === 0 && (
						<p className="text-sm text-destructive">
							An allow list needs at least one entry.
						</p>
					)}
				</>
			)}

			{error && <p className="text-sm text-destructive">{error}</p>}

			{!readOnly && (
				<Button onClick={save} disabled={!canSave || saveMutation.isPending}>
					{saveMutation.isPending && (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					)}
					Save
				</Button>
			)}
		</div>
	);
}

export function ProviderAccessTab({ orgId }: { orgId: string }) {
	const $api = useApi();
	const readOnly = !canWrite(useAdminRole());
	const { data, isLoading, isError } = $api.useQuery(
		"get",
		"/admin/organizations/{orgId}/provider-access",
		{ params: { path: { orgId } } },
	);

	const restriction = data?.restriction;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					Provider access
					{data && (
						<Badge variant={restriction ? "destructive" : "outline"}>
							{restriction
								? restriction.mode === "allow"
									? "Allow list"
									: "Deny list"
								: "Unrestricted"}
						</Badge>
					)}
				</CardTitle>
				<CardDescription>
					Restrict which providers, models and provider mappings this
					organization can use. Enforced by the gateway on every endpoint and on
					top of the organization&apos;s own IAM rules and compliance policy,
					which cannot override it.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						Loading…
					</div>
				) : isError || !data ? (
					<p className="text-sm text-destructive">
						Failed to load provider access
					</p>
				) : (
					<ProviderAccessForm
						key={JSON.stringify(data.restriction)}
						orgId={orgId}
						data={data}
						readOnly={readOnly}
					/>
				)}
			</CardContent>
		</Card>
	);
}
