"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Rocket } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useUpdateUser } from "@/hooks/useUser";
import { useAuth } from "@/lib/auth-client";
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
import { Label } from "@/lib/components/label";
import { RadioGroup, RadioGroupItem } from "@/lib/components/radio-group";
import { Step } from "@/lib/components/stepper";

const nameSchema = z.object({
	name: z.string().min(2, {
		message: "Name must be at least 2 characters",
	}),
});

interface WelcomeStepProps {
	onNameUpdated?: (name: string) => void;
	onReferralSelected?: (source: string, details?: string) => void;
}

const referralSources = [
	{ value: "twitter", label: "X (Formerly Twitter)" },
	{ value: "email", label: "Email" },
	{ value: "reddit", label: "Reddit" },
	{ value: "producthunt", label: "ProductHunt" },
	{ value: "devntell", label: "DevNTell podcast" },
	{ value: "other", label: "Other" },
];

export function WelcomeStep({
	onNameUpdated,
	onReferralSelected,
}: WelcomeStepProps) {
	const { useSession } = useAuth();
	const session = useSession();
	const user = session.data?.user;
	const organization = { name: "Your Organization" };
	const updateUser = useUpdateUser();
	const [selectedSource, setSelectedSource] = React.useState<string>("");
	const [otherDetails, setOtherDetails] = React.useState<string>("");

	const form = useForm<z.infer<typeof nameSchema>>({
		resolver: zodResolver(nameSchema),
		defaultValues: {
			name: user?.name || "",
		},
	});

	// Update form when user data loads
	React.useEffect(() => {
		if (user?.name) {
			form.setValue("name", user.name);
		}
	}, [user?.name, form]);

	const handleNameBlur = async () => {
		const name = form.getValues("name");
		if (name && name.length >= 2 && name !== user?.name) {
			try {
				await updateUser.mutateAsync({ body: { name } });
				onNameUpdated?.(name);
			} catch {
				// Silently fail - user can continue without name
			}
		}
	};

	const handleReferralChange = (value: string) => {
		setSelectedSource(value);
		if (value !== "other") {
			onReferralSelected?.(value);
		}
	};

	const handleOtherDetailsBlur = () => {
		if (selectedSource === "other" && otherDetails.trim()) {
			onReferralSelected?.(selectedSource, otherDetails);
		}
	};

	const needsName = !user?.name || user.name.length < 2;

	return (
		<Step>
			<div className="flex flex-col gap-6">
				<div className="flex flex-col gap-2 text-center">
					<h1 className="text-2xl font-bold">Welcome to LLM Gateway!</h1>
					<p className="text-muted-foreground">
						Let's get you set up with everything you need to start using the
						platform.
					</p>
				</div>

				{needsName && (
					<Card>
						<CardHeader>
							<CardTitle className="text-lg">
								What should we call you?
							</CardTitle>
							<CardDescription>
								This helps us personalize your experience
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Form {...form}>
								<FormField
									control={form.control}
									name="name"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Your name</FormLabel>
											<FormControl>
												<Input
													placeholder="Enter your name"
													{...field}
													onBlur={() => {
														field.onBlur();
														void handleNameBlur();
													}}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							</Form>
						</CardContent>
					</Card>
				)}

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Rocket className="h-5 w-5" />
							Your Project is Ready
						</CardTitle>
						<CardDescription>
							We've automatically created a project for you to get started.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						<div className="grid grid-cols-2 gap-4">
							<div>
								<p className="text-sm font-medium">User</p>
								<p className="text-muted-foreground text-sm">
									{form.watch("name") || user?.name || "—"}
								</p>
							</div>
							<div>
								<p className="text-sm font-medium">Email</p>
								<p className="text-muted-foreground text-sm">{user?.email}</p>
							</div>
							<div>
								<p className="text-sm font-medium">Organization</p>
								<p className="text-muted-foreground text-sm">
									{organization?.name}
								</p>
							</div>
							<div>
								<p className="text-sm font-medium">Project</p>
								<p className="text-muted-foreground text-sm">Default Project</p>
							</div>
						</div>

						<div className="rounded-md bg-muted p-4">
							<p className="text-sm">
								In this onboarding process, we'll help you:
							</p>
							<ul className="mt-2 list-inside list-disc text-sm">
								<li>Create your first API key to access the LLM Gateway</li>
								<li>
									Choose between buying credits or bringing your own API keys
								</li>
								<li>Set up your preferred payment method or provider keys</li>
							</ul>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-lg">
							How did you hear about us?
						</CardTitle>
						<CardDescription>
							This helps us understand how people discover LLM Gateway
							(optional)
						</CardDescription>
					</CardHeader>
					<CardContent>
						<RadioGroup
							value={selectedSource}
							onValueChange={handleReferralChange}
							className="grid grid-cols-2 gap-3"
						>
							{referralSources.map((source) => (
								<div key={source.value} className="flex items-center space-x-2">
									<RadioGroupItem value={source.value} id={source.value} />
									<Label
										htmlFor={source.value}
										className="flex-1 cursor-pointer text-sm font-normal"
									>
										{source.label}
									</Label>
								</div>
							))}
						</RadioGroup>

						{selectedSource === "other" && (
							<div className="mt-4">
								<Input
									placeholder="Where did you hear about us?"
									value={otherDetails}
									onChange={(e) => setOtherDetails(e.target.value)}
									onBlur={handleOtherDetailsBlur}
									className="w-full"
								/>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</Step>
	);
}
