import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Lock } from "lucide-react";
import { useState } from "react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ProviderSelect } from "@/components/provider-keys/provider-select";
import { UpgradeToProDialog } from "@/components/shared/upgrade-to-pro-dialog";
import { useDefaultOrganization } from "@/hooks/useOrganization";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/lib/components/form";
import { Input } from "@/lib/components/input";
import { Step } from "@/lib/components/stepper";
import { toast } from "@/lib/components/use-toast";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";

import { providers } from "@llmgateway/models";

const formSchema = z.object({
	provider: z.string().min(1, "Provider is required"),
	key: z.string().min(1, "API key is required"),
});

type FormValues = z.infer<typeof formSchema>;

export function ProviderKeyStep() {
	const config = useAppConfig();
	const [isLoading, setIsLoading] = useState(false);
	const [isSuccess, setIsSuccess] = useState(false);
	const { data: organization } = useDefaultOrganization();

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			provider: "",
			key: "",
		},
	});

	const api = useApi();
	const createProviderKey = api.useMutation("post", "/keys/provider");

	async function onSubmit(values: FormValues) {
		setIsLoading(true);
		try {
			await createProviderKey.mutateAsync({
				body: {
					organizationId: organization!.id,
					provider: values.provider,
					token: values.key,
				},
			});
			setIsSuccess(true);
			toast({
				title: "Provider key added",
				description: "Your provider key has been added successfully.",
			});
		} catch (error: any) {
			const errorMessage =
				error?.error?.message ||
				error?.message ||
				(error instanceof Error
					? error.message
					: "Failed to add provider key. Please try again.");
			toast({
				title: "Error",
				description: errorMessage,
				variant: "destructive",
			});
		} finally {
			setIsLoading(false);
		}
	}

	const isProPlan = organization?.plan === "pro";

	return (
		<Step>
			<div className="flex flex-col gap-6">
				<div className="flex flex-col gap-2 text-center">
					<h1 className="text-2xl font-bold">
						Add Provider Keys {!isProPlan && "(Pro Only)"}
					</h1>
					<p className="text-muted-foreground">
						Connect to your preferred LLM providers by adding their API keys.
					</p>
				</div>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<KeyRound className="h-5 w-5" />
							Provider Keys
						</CardTitle>
						<CardDescription>
							Add API keys for LLM providers like OpenAI, Anthropic, etc.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{!isProPlan && config.hosted ? (
							<div className="flex flex-col items-center gap-6 py-4">
								<div className="text-center">
									<h3 className="text-lg font-semibold mb-2 flex items-center justify-center gap-2">
										<Lock className="h-5 w-5" /> Upgrade to Pro
									</h3>
									<p className="text-muted-foreground mb-4">
										Unlock custom provider support and more advanced features.
									</p>
									<UpgradeToProDialog>
										<Button size="lg" type="button" className="mb-4">
											Upgrade to Pro
										</Button>
									</UpgradeToProDialog>
								</div>
							</div>
						) : !isSuccess ? (
							<Form {...form}>
								<form
									onSubmit={form.handleSubmit(onSubmit)}
									className="space-y-4"
								>
									<FormField
										control={form.control}
										name="provider"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Provider</FormLabel>
												<FormControl>
													<ProviderSelect
														onValueChange={field.onChange}
														value={field.value}
														providers={providers.filter(
															(p) => p.id !== "llmgateway",
														)}
														placeholder="Select a provider"
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
									<FormField
										control={form.control}
										name="key"
										render={({ field }) => (
											<FormItem>
												<FormLabel>API Key</FormLabel>
												<FormControl>
													<Input
														placeholder="Enter your provider API key"
														type="password"
														{...field}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
									<Button type="submit" className="w-full" disabled={isLoading}>
										{isLoading ? "Adding..." : "Add Provider Key"}
									</Button>
								</form>
							</Form>
						) : (
							<div className="flex flex-col gap-4">
								<div className="rounded-md bg-green-100 dark:bg-green-950 p-4">
									<p className="font-medium text-green-800 dark:text-green-300">
										Provider key added successfully!
									</p>
									<p className="mt-1 text-sm text-green-700 dark:text-green-400">
										You can add more provider keys later from the Provider Keys
										section.
									</p>
								</div>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</Step>
	);
}
