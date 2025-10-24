"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
	sendContactEmail,
	type ContactFormData,
} from "@/app/actions/send-contact-email";
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
import { countries } from "@/lib/countries";

const contactFormSchema = z.object({
	name: z.string().min(2, "Name must be at least 2 characters"),
	email: z.string().email("Invalid email address"),
	country: z.string().min(1, "Please select a country"),
	size: z.string().min(1, "Please select company size"),
	message: z.string().min(10, "Message must be at least 10 characters"),
	honeypot: z.string().optional(),
	timestamp: z.number().optional(),
});

export function ContactFormEnterprise() {
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isSuccess, setIsSuccess] = useState(false);
	const [formLoadTime] = useState(() => Date.now());

	const form = useForm<ContactFormData>({
		resolver: zodResolver(contactFormSchema),
		defaultValues: {
			name: "",
			email: "",
			country: "",
			size: "",
			message: "",
			honeypot: "",
			timestamp: formLoadTime,
		},
	});

	// Update timestamp when form loads
	useEffect(() => {
		form.setValue("timestamp", formLoadTime);
	}, [form, formLoadTime]);

	const onSubmit = async (data: ContactFormData) => {
		setIsSubmitting(true);
		try {
			const result = await sendContactEmail(data);

			if (result.success) {
				setIsSuccess(true);
				form.reset();
				toast.success("Message sent successfully!", {
					description: "Our team will reach out to you shortly.",
				});
			} else {
				toast.error("Failed to send message", {
					description: result.message || "Please try again later.",
				});
			}
		} catch {
			toast.error("Something went wrong", {
				description: "Please try again later or contact us directly.",
			});
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
							Get Started with Enterprise
						</h2>
						<p className="text-lg text-muted-foreground text-balance leading-relaxed max-w-2xl mx-auto">
							Tell us about your needs and our team will reach out to discuss
							how LLMGateway can support your organization.
						</p>
					</div>

					<div className="rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-8 sm:p-10 shadow-lg">
						{isSuccess ? (
							<div className="text-center py-12">
								<div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/20 mb-6">
									<CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
								</div>
								<h3 className="text-2xl font-semibold mb-2">
									Thank you for reaching out!
								</h3>
								<p className="text-muted-foreground mb-6">
									We've received your message and will get back to you within 24
									hours.
								</p>
								<Button
									onClick={() => setIsSuccess(false)}
									variant="outline"
									size="lg"
								>
									Send Another Message
								</Button>
							</div>
						) : (
							<Form {...form}>
								<form
									onSubmit={form.handleSubmit(onSubmit)}
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
											name="name"
											render={({ field }) => (
												<FormItem>
													<FormLabel>
														Name <span className="text-destructive">*</span>
													</FormLabel>
													<FormControl>
														<Input
															placeholder="John Doe"
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
														Company Email{" "}
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
									</div>

									<div className="grid gap-6 sm:grid-cols-2">
										<FormField
											control={form.control}
											name="country"
											render={({ field }) => (
												<FormItem>
													<FormLabel>
														Country <span className="text-destructive">*</span>
													</FormLabel>
													<Select
														onValueChange={field.onChange}
														defaultValue={field.value}
													>
														<FormControl>
															<SelectTrigger className="w-full bg-background h-11">
																<SelectValue placeholder="Select country" />
															</SelectTrigger>
														</FormControl>
														<SelectContent>
															{countries.map((country) => (
																<SelectItem key={country} value={country}>
																	{country}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
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
															<SelectItem value="1-50">
																1-50 employees
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

									<FormField
										control={form.control}
										name="message"
										render={({ field }) => (
											<FormItem>
												<FormLabel>
													How can we help?{" "}
													<span className="text-destructive">*</span>
												</FormLabel>
												<FormControl>
													<Textarea
														placeholder="Tell us about your use case, requirements, or any questions you have..."
														{...field}
														className="min-h-32 bg-background resize-none"
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>

									<div className="flex items-center justify-between pt-2">
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
													Submit Request
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
