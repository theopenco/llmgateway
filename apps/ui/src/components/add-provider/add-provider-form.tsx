"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	ArrowRight,
	Check,
	CheckCircle2,
	ChevronsUpDown,
	Info,
	Loader2,
} from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
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
import { countries } from "@/lib/countries";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

const providerFormSchema = z.object({
	providerName: z
		.string()
		.min(2, "Provider name must be at least 2 characters"),
	email: z.string().email("Invalid email address"),
	url: z.string().url("Please enter a valid URL"),
	country: z.string().min(1, "Please select a country"),
	complianceSoc2Type2: z.boolean(),
	complianceIso27001: z.boolean(),
	complianceGdpr: z.boolean(),
	dataRetentionDays: z.coerce
		.number({ message: "Enter a number of days" })
		.int("Enter a whole number of days")
		.min(0, "Data retention days cannot be negative"),
	trainsOnData: z.boolean(),
	honeypot: z.string().optional(),
	timestamp: z.number().optional(),
});

type ProviderFormData = z.infer<typeof providerFormSchema>;

const complianceOptions = [
	{ name: "complianceSoc2Type2", label: "SOC 2 Type II" },
	{ name: "complianceIso27001", label: "ISO 27001" },
	{ name: "complianceGdpr", label: "GDPR" },
] as const;

export function AddProviderForm({
	initialPayment,
}: {
	initialPayment?: "success" | "canceled" | null;
}) {
	const api = useApi();
	const posthog = usePostHog();
	const submitProvider = api.useMutation("post", "/public/contact/provider");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isSuccess, setIsSuccess] = useState(false);
	const [countryOpen, setCountryOpen] = useState(false);
	const [formLoadTime] = useState(() => Date.now());

	const form = useForm<ProviderFormData>({
		resolver: zodResolver(providerFormSchema),
		defaultValues: {
			providerName: "",
			email: "",
			url: "",
			country: "",
			complianceSoc2Type2: false,
			complianceIso27001: false,
			complianceGdpr: false,
			dataRetentionDays: 0,
			trainsOnData: false,
			honeypot: "",
			timestamp: formLoadTime,
		},
	});

	useEffect(() => {
		form.setValue("timestamp", formLoadTime);
	}, [form, formLoadTime]);

	const onSubmit = async (data: ProviderFormData) => {
		posthog.capture("provider_request_submitted", {
			country: data.country,
			trainsOnData: data.trainsOnData,
		});
		setIsSubmitting(true);
		try {
			const result = await submitProvider.mutateAsync({ body: data });

			if (result.success) {
				posthog.capture("provider_request_success", {
					country: data.country,
				});
				form.reset();
				if (result.checkoutUrl) {
					toast.success("Redirecting to secure checkout…");
					window.location.href = result.checkoutUrl;
					return;
				}
				// No checkout URL means the listing-fee payment couldn't be set up;
				// surface the server's message rather than a generic success.
				setIsSuccess(true);
				toast.success(result.message ?? "Request sent successfully!");
			} else {
				toast.error("Failed to send request", {
					description: result.message ?? "Please try again later.",
				});
			}
		} catch (error) {
			const description =
				(error as { message?: string } | undefined)?.message ??
				"Please try again later or contact us directly.";
			toast.error("Failed to send request", { description });
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<section className="py-20 sm:py-28">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-2xl">
					<div className="text-center mb-10">
						<h1 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
							Add a Provider
						</h1>
						<p className="text-lg text-muted-foreground text-balance leading-relaxed">
							Want your models listed on LLMGateway? Tell us about your provider
							and our team will get in touch.
						</p>
					</div>

					{initialPayment !== "success" && (
						<div className="mb-8 flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4">
							<Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
							<p className="text-sm text-muted-foreground">
								There is a{" "}
								<span className="font-semibold text-foreground">$500</span> fee
								to list a provider, collected securely via Stripe right after
								you submit. It is refunded in full if we don't end up listing
								your provider.
							</p>
						</div>
					)}

					{initialPayment === "canceled" && (
						<div className="mb-8 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
							Payment was canceled, so your provider isn't queued for listing
							yet. Your details were saved — submit the form again to retry the
							$500 listing fee whenever you're ready.
						</div>
					)}

					<div className="rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-8 sm:p-10 shadow-lg">
						{initialPayment === "success" ? (
							<div className="py-4 text-center">
								<div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/20 mb-6">
									<CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
								</div>
								<h3 className="text-2xl font-semibold mb-2">
									Payment received!
								</h3>
								<p className="text-muted-foreground">
									Thanks — we've received your $500 listing fee and your
									provider details. Our team will review your provider and
									follow up. The fee is refunded in full if we don't end up
									listing it.
								</p>
							</div>
						) : isSuccess ? (
							<div className="py-4 text-center">
								<div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/20 mb-6">
									<CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
								</div>
								<h3 className="text-2xl font-semibold mb-2">
									Thanks for your request!
								</h3>
								<p className="text-muted-foreground">
									We've received your provider details and will reach out
									shortly with the next steps.
								</p>
								<div className="mt-6">
									<Button
										onClick={() => setIsSuccess(false)}
										variant="outline"
										size="lg"
									>
										Submit Another Request
									</Button>
								</div>
							</div>
						) : (
							<Form {...form}>
								<form
									onSubmit={form.handleSubmit(onSubmit)}
									className="space-y-6"
								>
									<FormField
										control={form.control}
										name="honeypot"
										render={({ field }) => (
											<div
												className="absolute -left-[9999px] opacity-0 pointer-events-none"
												aria-hidden="true"
											>
												<FormItem>
													<FormLabel>Leave this field empty</FormLabel>
													<FormControl>
														<Input
															{...field}
															tabIndex={-1}
															autoComplete="off"
														/>
													</FormControl>
												</FormItem>
											</div>
										)}
									/>

									<div className="grid gap-6 sm:grid-cols-2">
										<FormField
											control={form.control}
											name="providerName"
											render={({ field }) => (
												<FormItem>
													<FormLabel>
														Provider Name{" "}
														<span className="text-destructive">*</span>
													</FormLabel>
													<FormControl>
														<Input
															placeholder="Acme AI"
															{...field}
															className="bg-background h-11"
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>

										<FormField
											control={form.control}
											name="email"
											render={({ field }) => (
												<FormItem>
													<FormLabel>
														Contact Email{" "}
														<span className="text-destructive">*</span>
													</FormLabel>
													<FormControl>
														<Input
															type="email"
															placeholder="team@acme.ai"
															{...field}
															className="bg-background h-11"
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>

									<div className="grid gap-6 sm:grid-cols-2">
										<FormField
											control={form.control}
											name="url"
											render={({ field }) => (
												<FormItem>
													<FormLabel>
														URL <span className="text-destructive">*</span>
													</FormLabel>
													<FormControl>
														<Input
															type="url"
															placeholder="https://acme.ai"
															{...field}
															className="bg-background h-11"
														/>
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
													<FormLabel>
														HQ Country{" "}
														<span className="text-destructive">*</span>
													</FormLabel>
													<Popover
														open={countryOpen}
														onOpenChange={setCountryOpen}
													>
														<PopoverTrigger asChild>
															<FormControl>
																<Button
																	type="button"
																	variant="outline"
																	role="combobox"
																	aria-expanded={countryOpen}
																	className={cn(
																		"w-full justify-between bg-background h-11 font-normal",
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
																				<span className="truncate">
																					{country}
																				</span>
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

									<FormItem>
										<FormLabel>Compliance</FormLabel>
										<FormDescription>
											Optional — tick any that apply.
										</FormDescription>
										<div className="mt-2 space-y-3 rounded-lg border border-border bg-background p-4">
											{complianceOptions.map((option) => (
												<FormField
													key={option.name}
													control={form.control}
													name={option.name}
													render={({ field }) => (
														<FormItem className="flex items-center justify-between gap-4 space-y-0">
															<FormLabel className="font-normal">
																{option.label}
															</FormLabel>
															<FormControl>
																<Checkbox
																	checked={field.value}
																	onCheckedChange={field.onChange}
																/>
															</FormControl>
														</FormItem>
													)}
												/>
											))}
										</div>
									</FormItem>

									<div className="grid gap-6 sm:grid-cols-2">
										<FormField
											control={form.control}
											name="dataRetentionDays"
											render={({ field }) => (
												<FormItem>
													<FormLabel>
														Data Retention (days){" "}
														<span className="text-destructive">*</span>
													</FormLabel>
													<FormControl>
														<Input
															type="number"
															min={0}
															placeholder="0"
															{...field}
															className="bg-background h-11"
														/>
													</FormControl>
													<FormDescription>
														Use 0 if you don't retain request data.
													</FormDescription>
													<FormMessage />
												</FormItem>
											)}
										/>

										<FormField
											control={form.control}
											name="trainsOnData"
											render={({ field }) => (
												<FormItem>
													<FormLabel>
														Training on Data{" "}
														<span className="text-destructive">*</span>
													</FormLabel>
													<div className="flex h-11 items-center justify-between gap-4 rounded-lg border border-border bg-background px-4">
														<span className="text-sm text-muted-foreground">
															{field.value ? "Yes" : "No"}
														</span>
														<FormControl>
															<Checkbox
																checked={field.value}
																onCheckedChange={field.onChange}
															/>
														</FormControl>
													</div>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>

									<div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:justify-between pt-2">
										<p className="text-sm text-muted-foreground">
											<span className="text-destructive">*</span> Required
											fields
										</p>
										<Button
											type="submit"
											size="lg"
											disabled={isSubmitting}
											className="w-full sm:w-auto min-w-[180px]"
										>
											{isSubmitting ? (
												<>
													<Loader2 className="mr-2 h-4 w-4 animate-spin" />
													Sending...
												</>
											) : (
												<>
													Continue to Payment
													<ArrowRight className="ml-2 h-4 w-4" />
												</>
											)}
										</Button>
									</div>
								</form>
							</Form>
						)}
					</div>
				</div>
			</div>
		</section>
	);
}
