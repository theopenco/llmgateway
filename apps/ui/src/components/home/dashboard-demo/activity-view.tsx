"use client";

import {
	Check,
	ChevronsUpDown,
	RefreshCw,
	Search,
	SlidersHorizontal,
	X,
} from "lucide-react";
import { useState } from "react";

import { DateRangeSelect } from "@/components/date-range-select";
import {
	DEMO_API_KEYS,
	DEMO_LOGS,
	DEMO_MODELS,
	PROVIDER_NAMES,
} from "@/components/home/dashboard-demo-data";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/lib/components/command";
import { Input } from "@/lib/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { cn } from "@/lib/utils";

import { useDemo } from "./context";
import { DemoLogCard } from "./log-card";

const UNIFIED_FINISH_REASONS = {
	COMPLETED: "completed",
	LENGTH_LIMIT: "length_limit",
	CONTENT_FILTER: "content_filter",
	TOOL_CALLS: "tool_calls",
	GATEWAY_ERROR: "gateway_error",
	UPSTREAM_ERROR: "upstream_error",
	CANCELED: "canceled",
	UNKNOWN: "unknown",
} as const;

const ERROR_TYPES = [
	{ value: "all", label: "All logs" },
	{ value: "any", label: "Has Error" },
	{ value: "client_error", label: "Client Errors" },
	{ value: "gateway_error", label: "Gateway Errors" },
	{ value: "upstream_error", label: "Upstream Errors" },
];

const PROVIDER_OPTIONS = Object.entries(PROVIDER_NAMES)
	.map(([id, label]) => ({ id, label }))
	.sort((a, b) => a.label.localeCompare(b.label));

function titleCase(key: string) {
	return key
		.toLowerCase()
		.replace(/_/g, " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ActivityView() {
	const { openedAt, project, track, notify } = useDemo();
	const [windowSeconds, setWindowSeconds] = useState<number | undefined>();
	const [dateRangeKey, setDateRangeKey] = useState(0);
	const [provider, setProvider] = useState<string | undefined>();
	const [model, setModel] = useState<string | undefined>();
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [modelSearch, setModelSearch] = useState("");
	const [apiKeyId, setApiKeyId] = useState<string | undefined>();
	const [usedMode, setUsedMode] = useState<string | undefined>();
	const [errorType, setErrorType] = useState<string | undefined>();
	const [unifiedReason, setUnifiedReason] = useState<string | undefined>();
	const [headerKey, setHeaderKey] = useState("");
	const [headerValue, setHeaderValue] = useState("");
	const [sessionId, setSessionId] = useState("");
	const [refreshing, setRefreshing] = useState(false);

	const selectedModel = DEMO_MODELS.find((option) => option.id === model);
	const normalizedSearch = modelSearch
		.trim()
		.toLowerCase()
		.replace(/[\s/_-]/g, "");
	const modelOptions = DEMO_MODELS.filter((option) => {
		if (provider && !option.providers.includes(provider)) {
			return false;
		}
		if (!normalizedSearch) {
			return true;
		}
		return [option.id, option.name].some((field) =>
			field
				.toLowerCase()
				.replace(/[\s/_-]/g, "")
				.includes(normalizedSearch),
		);
	});

	const logs = DEMO_LOGS.filter((log) => {
		if (windowSeconds !== undefined && log.agoSeconds > windowSeconds) {
			return false;
		}
		if (provider && log.usedProvider !== provider) {
			return false;
		}
		if (model && !log.requestedModel.endsWith(model)) {
			return false;
		}
		if (apiKeyId && log.apiKeyId !== apiKeyId) {
			return false;
		}
		if (usedMode && log.usedMode !== usedMode) {
			return false;
		}
		if (errorType && errorType !== "all") {
			if (
				errorType === "any" ? !log.hasError : log.finishReason !== errorType
			) {
				return false;
			}
		}
		if (unifiedReason && log.unifiedFinishReason !== unifiedReason) {
			return false;
		}
		return !headerKey.trim() && !headerValue.trim() && !sessionId.trim();
	});

	const activeFilterCount = [
		windowSeconds,
		unifiedReason,
		provider,
		model,
		apiKeyId,
		usedMode,
		errorType,
		headerKey.trim() || undefined,
		headerValue.trim() || undefined,
		sessionId.trim() || undefined,
	].filter((value) => value !== undefined).length;

	const change =
		(name: string, setter: (value: string | undefined) => void) =>
		(value: string) => {
			setter(value === "all" ? undefined : value);
			track("activity_filter", `${name}:${value}`);
		};

	const reset = () => {
		setWindowSeconds(undefined);
		setDateRangeKey((key) => key + 1);
		setProvider(undefined);
		setModel(undefined);
		setApiKeyId(undefined);
		setUsedMode(undefined);
		setErrorType(undefined);
		setUnifiedReason(undefined);
		setHeaderKey("");
		setHeaderValue("");
		setSessionId("");
		track("activity_filter", "reset");
	};

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div>
					<h2 className="text-3xl font-bold tracking-tight">Activity Logs</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						Your recent API requests and system events
					</p>
				</div>
				<div className="max-w-full space-y-4 overflow-hidden">
					<div className="sticky top-0 z-10 pb-1 pt-1">
						<div className="rounded-xl border bg-card/95 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/85">
							<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
								<div className="flex items-center gap-2">
									<SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
									<span className="text-sm font-medium">Filters</span>
									{activeFilterCount > 0 && (
										<Badge
											variant="secondary"
											className="h-5 rounded-full px-2 text-xs font-normal"
										>
											{activeFilterCount} active
										</Badge>
									)}
								</div>
								<div className="flex items-center gap-1.5">
									{activeFilterCount > 0 && (
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={reset}
											className="h-8 gap-1.5 text-muted-foreground"
										>
											<X className="h-3.5 w-3.5" />
											Reset
										</Button>
									)}
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={refreshing}
										onClick={() => {
											setRefreshing(true);
											track("activity_refresh", "click");
											setTimeout(() => setRefreshing(false), 600);
										}}
										className="h-8 gap-1.5"
									>
										<RefreshCw
											className={cn(
												"h-3.5 w-3.5",
												refreshing && "animate-spin",
											)}
										/>
										{refreshing ? "Refreshing..." : "Refresh"}
									</Button>
								</div>
							</div>

							<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
								<DateRangeSelect
									key={dateRangeKey}
									onChange={(value, range) => {
										setWindowSeconds(
											(range.end.getTime() - range.start.getTime()) / 1000,
										);
										track("activity_filter", `range:${value}`);
									}}
									className="w-full"
								/>

								<Select
									onValueChange={(value) => {
										const next = value === "all" ? undefined : value;
										setProvider(next);
										if (
											next &&
											model &&
											!DEMO_MODELS.some(
												(option) =>
													option.id === model &&
													option.providers.includes(next),
											)
										) {
											setModel(undefined);
										}
										track("activity_filter", `provider:${value}`);
									}}
									value={provider ?? "all"}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Filter by provider" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All providers</SelectItem>
										{PROVIDER_OPTIONS.map((option) => (
											<SelectItem key={option.id} value={option.id}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>

								<Popover
									open={modelPickerOpen}
									onOpenChange={setModelPickerOpen}
								>
									<PopoverTrigger asChild>
										<Button
											variant="outline"
											role="combobox"
											aria-expanded={modelPickerOpen}
											className={cn(
												"w-full justify-between font-normal",
												!model && "text-muted-foreground",
											)}
										>
											<span className="truncate">
												{selectedModel?.name ?? model ?? "All models"}
											</span>
											<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
										</Button>
									</PopoverTrigger>
									<PopoverContent className="w-[320px] p-0" align="start">
										<Command shouldFilter={false}>
											<CommandInput
												placeholder="Search models..."
												value={modelSearch}
												onValueChange={setModelSearch}
											/>
											<CommandList>
												<CommandEmpty>No models found.</CommandEmpty>
												<CommandItem
													value="all"
													onSelect={() => {
														change("model", setModel)("all");
														setModelPickerOpen(false);
														setModelSearch("");
													}}
												>
													<Check
														className={cn(
															"h-4 w-4",
															!model ? "opacity-100" : "opacity-0",
														)}
													/>
													All models
												</CommandItem>
												{modelOptions.map((option) => (
													<CommandItem
														key={option.id}
														value={`${option.id} ${option.name}`}
														onSelect={() => {
															change("model", setModel)(option.id);
															setModelPickerOpen(false);
															setModelSearch("");
														}}
													>
														<Check
															className={cn(
																"h-4 w-4",
																model === option.id
																	? "opacity-100"
																	: "opacity-0",
															)}
														/>
														<div className="flex min-w-0 flex-col">
															<span className="truncate">{option.name}</span>
															<span className="truncate text-xs text-muted-foreground">
																{option.id}
															</span>
														</div>
													</CommandItem>
												))}
											</CommandList>
										</Command>
									</PopoverContent>
								</Popover>

								<Select
									onValueChange={change("apiKeyId", setApiKeyId)}
									value={apiKeyId ?? "all"}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Filter by API key" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All API keys</SelectItem>
										{DEMO_API_KEYS.map((key) => (
											<SelectItem key={key.id} value={key.id}>
												{key.description}
											</SelectItem>
										))}
									</SelectContent>
								</Select>

								<Select
									onValueChange={change("usedMode", setUsedMode)}
									value={usedMode ?? "all"}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Filter by billing" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All billing</SelectItem>
										<SelectItem value="credits">Credits</SelectItem>
										<SelectItem value="api-keys">BYOK</SelectItem>
									</SelectContent>
								</Select>

								<Select
									onValueChange={change("errorType", setErrorType)}
									value={errorType ?? "all"}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Filter by error" />
									</SelectTrigger>
									<SelectContent>
										{ERROR_TYPES.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>

								<Select
									onValueChange={change(
										"unifiedFinishReason",
										setUnifiedReason,
									)}
									value={unifiedReason ?? "all"}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Filter by unified reason" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All unified reasons</SelectItem>
										{Object.entries(UNIFIED_FINISH_REASONS).map(
											([key, value]) => (
												<SelectItem key={value} value={value}>
													{titleCase(key)}
												</SelectItem>
											),
										)}
									</SelectContent>
								</Select>

								<div className="relative">
									<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
									<Input
										placeholder="Header key (e.g. uid)"
										value={headerKey}
										onChange={(e) => setHeaderKey(e.target.value)}
										className="w-full pl-8"
									/>
								</div>

								<div className="relative">
									<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
									<Input
										placeholder="Header value (e.g. 12345)"
										value={headerValue}
										onChange={(e) => setHeaderValue(e.target.value)}
										className="w-full pl-8"
									/>
								</div>

								<div className="relative">
									<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
									<Input
										placeholder="Session ID"
										value={sessionId}
										onChange={(e) => setSessionId(e.target.value)}
										className="w-full pl-8"
									/>
								</div>
							</div>
						</div>
					</div>

					<div className="@container space-y-4">
						{logs.map((log) => (
							<DemoLogCard
								key={log.id}
								log={log}
								openedAt={openedAt}
								project={project}
								onToggle={(expanded) => {
									if (expanded) {
										track("log_expand", log.unifiedFinishReason);
									}
								}}
							/>
						))}

						{logs.length > 0 && (
							<div className="flex justify-center pt-4">
								<Button
									variant="outline"
									onClick={() =>
										notify("Sample data ends here. Your own logs keep going.")
									}
								>
									Load More
								</Button>
							</div>
						)}

						{logs.length === 0 && (
							<div className="py-4 text-center text-muted-foreground">
								No logs found matching the selected filters.
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
