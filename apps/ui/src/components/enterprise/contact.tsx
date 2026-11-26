"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, CalendarCheck, Info, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { AuthLink } from "@/components/shared/auth-link";
import { Button } from "@/lib/components/button";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/lib/components/form";
import { Input } from "@/lib/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { Textarea } from "@/lib/components/textarea";
import { useApi } from "@/lib/fetch-client";
import { usePostHog } from "@/lib/posthog";

import { ENTERPRISE_BOOKING_URL, MARKETING_STATS } from "@llmgateway/shared";

import { CalendlyInline } from "./calendly-inline";
import { AirsideRedirect, ContactAudiencePicker } from "./contact-audience";

import type { ContactAudience } from "./contact-audience";

// Teams this small don't need enterprise; the form points them to the free plan.
const NON_ENTERPRISE_SIZE = "1-5";

const contactFormSchema = z.object({
	email: z.string().email("Invalid email address"),
	size: z.string().min(1, "Please select company size"),
	message: z.string().max(5000).optional(),
	honeypot: z.string().optional(),
	timestamp: z.number().optional(),
});

type ContactFormData = z.infer<typeof contactFormSchema>;

export function ContactFormEnterprise() {
	const api = useApi();
	const posthog = usePostHog();
	const submitContact = api.useMutation("post", "/public/contact/enterprise");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isSuccess, setIsSuccess] = useState(false);
	const [submittedEmail, setSubmittedEmail] = useState("");
	const [formLoadTime] = useState(() => Date.now());
	const [audience, setAudience] = useState<ContactAudience>("company");
	const startedRef = useRef(false);
	const successHeadingRef = useRef<HTMLHeadingElement>(null);

	// The submit button unmounts on success; land keyboard users on the next step.
	useEffect(() => {
		if (isSuccess) {
			successHeadingRef.current?.focus();
		}
	}, [isSuccess]);

	const form = useForm<ContactFormData>({
		resolver: zodResolver(contactFormSchema),
		defaultValues: {
			email: "",
			size: "",
			message: "",
			honeypot: "",
			timestamp: formLoadTime,
		},
	});

	const isNonEnterpriseSize = form.watch("size") === NON_ENTERPRISE_SIZE;

	// Update timestamp when form loads
	useEffect(() => {
		form.setValue("timestamp", formLoadTime);
	}, [form, formLoadTime]);

	const trackStart = () => {
		if (startedRef.current) {
			return;
		}
		startedRef.current = true;
		posthog.capture("enterprise_contact_started");
	};

	const onSubmit = async (data: ContactFormData) => {
		if (data.size === NON_ENTERPRISE_SIZE) {
			return;
		}
		posthog.capture("enterprise_contact_submitted", {
			companySize: data.size,
		});
		setIsSubmitting(true);
		try {
			const result = await submitContact.mutateAsync({
				body: { ...data, message: data.message?.trim() || undefined },
			});

			if (result.success) {
				posthog.capture("enterprise_contact_success", {
					companySize: data.size,
				});
				setSubmittedEmail(data.email);
				setIsSuccess(true);
				form.reset();
			} else {
				toast.error("Failed to send message", {
					description: result.message ?? "Please try again later.",
				});
			}
		} catch (error) {
			// Spam/rate-limit responses come back as typed error bodies with a
			// message; fall back to a generic note for transport failures.
			const description =
				(error as { message?: string } | undefined)?.message ??
				"Please try again later or contact us directly.";
			toast.error("Failed to send message", { description });
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<section className="py-20 sm:py-28" id="contact">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-4xl">
					<div className="text-center mb-12">
						<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl text-balance">
							Book a call with our team
						</h2>
						<p className="text-lg text-muted-foreground text-balance leading-relaxed max-w-2xl mx-auto">
							Two questions, then pick a time. You talk to the engineers who run
							the gateway, and every plan starts with the 30-Day Production
							Pilot. Inference providers listing their models start on Airside
							instead.
						</p>
					</div>

					<div className="rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-8 sm:p-10 shadow-lg">
						{isSuccess ? (
							<div>
								<div className="mb-8 text-center">
									<div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/20 mb-6">
										<CalendarCheck className="w-8 h-8 text-green-600 dark:text-green-400" />
									</div>
									<h3
										ref={successHeadingRef}
										tabIndex={-1}
										className="text-2xl font-semibold mb-2 outline-none"
									>
										Pick a time
									</h3>
									<p className="text-muted-foreground text-balance">
										Choose a slot below. We also sent a confirmation link to{" "}
										<span className="font-medium text-foreground">
											{submittedEmail}
										</span>
										. Open it so your request reaches our team even if no slot
										fits.
									</p>
								</div>
								<CalendlyInline
									url={ENTERPRISE_BOOKING_URL}
									email={submittedEmail}
								/>
								<div className="mt-6 text-center">
									<Button
										onClick={() => setIsSuccess(false)}
										variant="outline"
										size="lg"
									>
										Use a different email
									</Button>
								</div>
							</div>
						) : (
							<div className="space-y-8">
								<ContactAudiencePicker
									value={audience}
									onChange={setAudience}
								/>
								{audience === "provider" ? (
									<AirsideRedirect />
								) : (
									<Form {...form}>
										<form
											onSubmit={form.handleSubmit(onSubmit)}
											onFocusCapture={trackStart}
											className="space-y-6"
										>
											{/* Honeypot field - hidden from users but visible to bots */}
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
													name="email"
													render={({ field }) => (
														<FormItem>
															<FormLabel>
																Work Email{" "}
																<span className="text-destructive">*</span>
															</FormLabel>
															<FormControl>
																<Input
																	type="email"
																	placeholder="john@company.com"
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
													name="size"
													render={({ field }) => (
														<FormItem>
															<FormLabel>
																Company Size{" "}
																<span className="text-destructive">*</span>
															</FormLabel>
															<Select
																onValueChange={field.onChange}
																defaultValue={field.value}
															>
																<FormControl>
																	<SelectTrigger className="w-full bg-background h-11">
																		<SelectValue placeholder="Select size" />
																	</SelectTrigger>
																</FormControl>
																<SelectContent>
																	<SelectItem value={NON_ENTERPRISE_SIZE}>
																		1-5 seats
																	</SelectItem>
																	<SelectItem value="6-10">
																		6-10 employees
																	</SelectItem>
																	<SelectItem value="11-25">
																		11-25 employees
																	</SelectItem>
																	<SelectItem value="26-50">
																		26-50 employees
																	</SelectItem>
																	<SelectItem value="51-200">
																		51-200 employees
																	</SelectItem>
																	<SelectItem value="201-500">
																		201-500 employees
																	</SelectItem>
																	<SelectItem value="501-1000">
																		501-1000 employees
																	</SelectItem>
																	<SelectItem value="1000+">
																		1000+ employees
																	</SelectItem>
																</SelectContent>
															</Select>
															<FormMessage />
														</FormItem>
													)}
												/>
											</div>

											{isNonEnterpriseSize && (
												<div className="flex gap-3 rounded-xl border border-border bg-muted/40 p-4">
													<Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
													<div className="space-y-2 text-sm">
														<p className="font-medium">
															Teams of 1-5 don't need Enterprise
														</p>
														<p className="text-muted-foreground">
															You can use LLM Gateway for free — no need to go
															through Enterprise. Enterprise is usually priced
															from {MARKETING_STATS.enterpriseSmallTeamPrice} a
															year for small teams, and from{" "}
															{MARKETING_STATS.enterpriseTeamPrice} a year for
															bigger teams.
														</p>
														<Button asChild size="sm">
															<AuthLink href="/signup">
																Get started for free
																<ArrowRight className="ml-2 h-4 w-4" />
															</AuthLink>
														</Button>
													</div>
												</div>
											)}

											<FormField
												control={form.control}
												name="message"
												render={({ field }) => (
													<FormItem>
														<FormLabel>
															Anything we should know?{" "}
															<span className="text-muted-foreground font-normal">
																(optional)
															</span>
														</FormLabel>
														<FormControl>
															<Textarea
																placeholder="Use case, providers, compliance needs, self-hosted or cloud..."
																{...field}
																className="min-h-24 bg-background resize-none"
															/>
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>

											<div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:justify-between pt-2">
												<p className="text-sm text-muted-foreground">
													Pick a time on the next screen. NDA and DPA on
													request.
												</p>
												<Button
													type="submit"
													size="lg"
													disabled={isSubmitting || isNonEnterpriseSize}
													className="w-full sm:w-auto min-w-[180px]"
												>
													{isSubmitting ? (
														<>
															<Loader2 className="mr-2 h-4 w-4 animate-spin" />
															Sending...
														</>
													) : (
														<>
															Book a call
															<ArrowRight className="ml-2 h-4 w-4" />
														</>
													)}
												</Button>
											</div>
										</form>
									</Form>
								)}
							</div>
						)}
					</div>
				</div>
			</div>
		</section>
	);
}
