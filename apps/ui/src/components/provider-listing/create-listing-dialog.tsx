"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	Check,
	ChevronsUpDown,
	Loader2,
	Plus,
	Trash2,
	TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/lib/components/button";
import { Checkbox } from "@/lib/components/checkbox";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/lib/components/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/lib/components/dialog";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/lib/components/form";
import { Input } from "@/lib/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import { Slider } from "@/lib/components/slider";
import { useToast } from "@/lib/components/use-toast";
import { countries } from "@/lib/countries";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { models, type ProviderModelMapping } from "@llmgateway/models";

const claimedModelSchema = z.object({
	modelId: z.string().min(1, "Pick a model"),
	externalId: z.string().min(1, "Enter the model id your endpoint expects"),
});

const listingFormSchema = z.object({
	providerName: z.string().min(2, "Provider name is required").max(100),
	url: z.string().url("Enter a valid website URL"),
	termsUrl: z.string().url("Enter a valid terms of service URL"),
	privacyUrl: z.string().url("Enter a valid privacy policy URL"),
	statusPageUrl: z
		.string()
		.url("Enter a valid status page URL")
		.optional()
		.or(z.literal("")),
	country: z.string().min(1, "Select a country"),
	complianceSoc2Type2: z.boolean(),
	complianceIso27001: z.boolean(),
	complianceGdpr: z.boolean(),
	dataRetentionDays: z.coerce
		.number({ message: "Enter a number of days" })
		.int("Enter a whole number of days")
		.min(0, "Cannot be negative"),
	trainsOnData: z.boolean(),
	baseUrl: z
		.string()
		.url("Enter a valid base URL")
		.refine((value) => value.startsWith("https://"), {
			message: "Base URL must use https",
		}),
	testApiKey: z.string().min(8, "Enter an API key for validation testing"),
	claimedModels: z
		.array(claimedModelSchema)
		.min(1, "Claim at least one model")
		.max(10),
	discountPercent: z.number().min(1).max(50),
});

type ListingFormData = z.infer<typeof listingFormSchema>;

// Catalogue models a listed endpoint can serve: anything with a live
// chat-capable mapping.
function getClaimableModels(): string[] {
	const now = new Date();
	return models
		.filter((model) =>
			(model.providers as readonly ProviderModelMapping[]).some(
				(mapping) =>
					!(
						mapping.imageGenerations ||
						mapping.videoGenerations ||
						mapping.embeddings ||
						mapping.speechGenerations ||
						mapping.transcriptions ||
						mapping.ocr
					) && !(mapping.deactivatedAt && now >= mapping.deactivatedAt),
			),
		)
		.map((model) => model.id)
		.sort();
}

function ModelCombobox({
	value,
	onChange,
	options,
}: {
	value: string;
	onChange: (value: string) => void;
	options: string[];
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					role="combobox"
					aria-expanded={open}
					className={cn(
						"w-full justify-between font-normal",
						!value && "text-muted-foreground",
					)}
				>
					<span className="truncate font-mono text-sm">
						{value || "Select model"}
					</span>
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="w-[--radix-popover-trigger-width] p-0"
				align="start"
			>
				<Command>
					<CommandInput placeholder="Search models..." />
					<CommandList>
						<CommandEmpty>No model found.</CommandEmpty>
						<CommandGroup>
							{options.map((modelId) => (
								<CommandItem
									key={modelId}
									value={modelId}
									onSelect={() => {
										onChange(modelId);
										setOpen(false);
									}}
								>
									<span className="truncate font-mono text-sm">{modelId}</span>
									<Check
										className={cn(
											"ml-auto h-4 w-4 shrink-0",
											value === modelId ? "opacity-100" : "opacity-0",
										)}
									/>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

export function CreateListingDialog({
	orgId,
	open,
	onOpenChange,
}: {
	orgId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const api = useApi();
	const { toast } = useToast();
	const [countryOpen, setCountryOpen] = useState(false);
	const claimableModels = useMemo(getClaimableModels, []);

	const form = useForm<ListingFormData>({
		resolver: zodResolver(listingFormSchema),
		defaultValues: {
			providerName: "",
			url: "",
			termsUrl: "",
			privacyUrl: "",
			statusPageUrl: "",
			country: "",
			complianceSoc2Type2: false,
			complianceIso27001: false,
			complianceGdpr: false,
			dataRetentionDays: 0,
			trainsOnData: false,
			baseUrl: "",
			testApiKey: "",
			claimedModels: [{ modelId: "", externalId: "" }],
			discountPercent: 15,
		},
	});
	const { fields, append, remove } = useFieldArray({
		control: form.control,
		name: "claimedModels",
	});

	const createMutation = api.useMutation("post", "/provider-listings");
	const discount = form.watch("discountPercent");

	const onSubmit = (values: ListingFormData) => {
		createMutation.mutate(
			{
				body: {
					organizationId: orgId,
					providerName: values.providerName,
					url: values.url,
					termsUrl: values.termsUrl,
					privacyUrl: values.privacyUrl,
					statusPageUrl: values.statusPageUrl || undefined,
					country: values.country,
					complianceSoc2Type2: values.complianceSoc2Type2,
					complianceIso27001: values.complianceIso27001,
					complianceGdpr: values.complianceGdpr,
					dataRetentionDays: values.dataRetentionDays,
					trainsOnData: values.trainsOnData,
					baseUrl: values.baseUrl,
					testApiKey: values.testApiKey,
					claimedModels: values.claimedModels,
					discountPercent: values.discountPercent / 100,
				},
			},
			{
				onSuccess: (data) => {
					if (data.checkoutUrl) {
						window.location.href = data.checkoutUrl;
						return;
					}
					toast({
						title: "Listing created",
						description:
							"We couldn't start the payment right now — retry it from the listing card.",
					});
					onOpenChange(false);
				},
				onError: (error: { message?: string } | undefined) => {
					toast({
						title: "Could not create listing",
						description: error?.message ?? "Please try again.",
						variant: "destructive",
					});
				},
			},
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>List your provider</DialogTitle>
					<DialogDescription>
						Tell us about your platform, connect your endpoint, and commit your
						discount. You&apos;ll pay the listing fee at checkout.
					</DialogDescription>
				</DialogHeader>

				<Form {...form}>
					<form
						onSubmit={form.handleSubmit(onSubmit)}
						className="space-y-6"
						data-testid="create-listing-form"
					>
						<div className="space-y-4">
							<h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
								Company
							</h3>
							<div className="grid gap-4 sm:grid-cols-2">
								<FormField
									control={form.control}
									name="providerName"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Provider name</FormLabel>
											<FormControl>
												<Input placeholder="Acme Inference" {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="country"
									render={({ field }) => (
										<FormItem className="flex flex-col">
											<FormLabel>HQ country</FormLabel>
											<Popover open={countryOpen} onOpenChange={setCountryOpen}>
												<PopoverTrigger asChild>
													<FormControl>
														<Button
															type="button"
															variant="outline"
															role="combobox"
															aria-expanded={countryOpen}
															className={cn(
																"w-full justify-between font-normal",
																!field.value && "text-muted-foreground",
															)}
														>
															{field.value || "Select country"}
															<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
														</Button>
													</FormControl>
												</PopoverTrigger>
												<PopoverContent
													className="w-[--radix-popover-trigger-width] p-0"
													align="start"
												>
													<Command>
														<CommandInput placeholder="Search country..." />
														<CommandList>
															<CommandEmpty>No country found.</CommandEmpty>
															<CommandGroup>
																{countries.map((country) => (
																	<CommandItem
																		key={country}
																		value={country}
																		onSelect={() => {
																			field.onChange(country);
																			setCountryOpen(false);
																		}}
																	>
																		<span className="truncate">{country}</span>
																		<Check
																			className={cn(
																				"ml-auto h-4 w-4 shrink-0",
																				field.value === country
																					? "opacity-100"
																					: "opacity-0",
																			)}
																		/>
																	</CommandItem>
																))}
															</CommandGroup>
														</CommandList>
													</Command>
												</PopoverContent>
											</Popover>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
							<FormField
								control={form.control}
								name="url"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Website</FormLabel>
										<FormControl>
											<Input placeholder="https://acme.ai" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<div className="grid gap-4 sm:grid-cols-3">
								<FormField
									control={form.control}
									name="termsUrl"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Terms of service</FormLabel>
											<FormControl>
												<Input placeholder="https://acme.ai/terms" {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="privacyUrl"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Privacy policy</FormLabel>
											<FormControl>
												<Input
													placeholder="https://acme.ai/privacy"
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="statusPageUrl"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Status page (optional)</FormLabel>
											<FormControl>
												<Input
													placeholder="https://status.acme.ai"
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
							<div className="grid gap-4 sm:grid-cols-2">
								<FormField
									control={form.control}
									name="dataRetentionDays"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Data retention (days)</FormLabel>
											<FormControl>
												<Input type="number" min={0} {...field} />
											</FormControl>
											<FormDescription>
												0 means no prompt retention.
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
								<div className="space-y-3 pt-1">
									<FormLabel>Compliance</FormLabel>
									{(
										[
											["complianceSoc2Type2", "SOC 2 Type II"],
											["complianceIso27001", "ISO 27001"],
											["complianceGdpr", "GDPR"],
											["trainsOnData", "Trains on customer data"],
										] as const
									).map(([name, label]) => (
										<FormField
											key={name}
											control={form.control}
											name={name}
											render={({ field }) => (
												<FormItem className="flex flex-row items-center gap-2 space-y-0">
													<FormControl>
														<Checkbox
															checked={field.value}
															onCheckedChange={field.onChange}
														/>
													</FormControl>
													<FormLabel className="font-normal">{label}</FormLabel>
												</FormItem>
											)}
										/>
									))}
								</div>
							</div>
						</div>

						<div className="space-y-4">
							<h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
								Endpoint &amp; models
							</h3>
							<FormField
								control={form.control}
								name="baseUrl"
								render={({ field }) => (
									<FormItem>
										<FormLabel>OpenAI-compatible base URL</FormLabel>
										<FormControl>
											<Input placeholder="https://api.acme.ai" {...field} />
										</FormControl>
										<FormDescription>
											The validation suite calls{" "}
											<code className="font-mono text-xs">
												/v1/chat/completions
											</code>{" "}
											on this host.
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="testApiKey"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Test API key</FormLabel>
										<FormControl>
											<Input
												type="password"
												placeholder="sk-..."
												autoComplete="off"
												{...field}
											/>
										</FormControl>
										<FormDescription>
											Stored encrypted; only used to run validation tests.
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
							<div className="space-y-3">
								<FormLabel>Models you serve</FormLabel>
								{fields.map((row, index) => (
									<div key={row.id} className="flex items-start gap-2">
										<FormField
											control={form.control}
											name={`claimedModels.${index}.modelId`}
											render={({ field }) => (
												<FormItem className="flex-1">
													<FormControl>
														<ModelCombobox
															value={field.value}
															onChange={(modelId) => {
																field.onChange(modelId);
																const current = form.getValues(
																	`claimedModels.${index}.externalId`,
																);
																if (!current) {
																	form.setValue(
																		`claimedModels.${index}.externalId`,
																		modelId,
																	);
																}
															}}
															options={claimableModels}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
										<FormField
											control={form.control}
											name={`claimedModels.${index}.externalId`}
											render={({ field }) => (
												<FormItem className="flex-1">
													<FormControl>
														<Input
															placeholder="Model id on your endpoint"
															className="font-mono text-sm"
															{...field}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											disabled={fields.length === 1}
											onClick={() => remove(index)}
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									</div>
								))}
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={fields.length >= 10}
									onClick={() => append({ modelId: "", externalId: "" })}
								>
									<Plus className="mr-1 h-4 w-4" />
									Add model
								</Button>
							</div>
						</div>

						<div className="space-y-4">
							<h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
								Discount commitment
							</h3>
							<FormField
								control={form.control}
								name="discountPercent"
								render={({ field }) => (
									<FormItem>
										<div className="flex items-center justify-between">
											<FormLabel>Discount off your list price</FormLabel>
											<span className="text-lg font-semibold tabular-nums">
												{field.value}%
											</span>
										</div>
										<FormControl>
											<Slider
												min={1}
												max={50}
												step={1}
												value={[field.value]}
												onValueChange={([value]) => field.onChange(value)}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<div className="flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-sm">
								<TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
								<p className="text-muted-foreground">
									The router will price your models as if they cost{" "}
									<span className="font-medium text-foreground">
										{100 - discount}%
									</span>{" "}
									of list price when picking a provider. A deeper discount
									directly increases how much traffic is routed to you.
								</p>
							</div>
						</div>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={createMutation.isPending}>
								{createMutation.isPending && (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								)}
								Continue to payment
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
