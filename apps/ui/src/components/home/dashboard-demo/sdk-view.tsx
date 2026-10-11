"use client";

import { KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";

import { SDK_SETTINGS } from "@/components/home/dashboard-demo-data";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { Separator } from "@/lib/components/separator";
import { Switch } from "@/lib/components/switch";
import { Textarea } from "@/lib/components/textarea";

import { READ_ONLY_MESSAGE, useDemo } from "./context";

import type { ReactNode } from "react";

function Field({
	id,
	label,
	hint,
	children,
	wide,
}: {
	id: string;
	label: string;
	hint?: string;
	children: ReactNode;
	wide?: boolean;
}) {
	return (
		<div className={wide ? "grid gap-2" : "grid gap-2 sm:max-w-md"}>
			<Label htmlFor={id}>{label}</Label>
			{children}
			{hint && <p className="text-sm text-muted-foreground">{hint}</p>}
		</div>
	);
}

export function SdkView() {
	const { notify, project, track } = useDemo();
	const [enabled, setEnabled] = useState(true);

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="mx-auto max-w-3xl space-y-6">
					<h2 className="text-3xl font-bold tracking-tight">Payments SDK</h2>
					<Card>
						<CardHeader>
							<CardTitle>Embeddable Payments</CardTitle>
							<CardDescription>
								Embed end-user payments and sessions into your own site:
								configure end-user sessions and platform secret keys for this
								project.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-8">
							<section className="space-y-4">
								<div>
									<h3 className="text-lg font-medium">End-user Sessions</h3>
									<p className="text-sm text-muted-foreground">
										Project: {project.name}
									</p>
								</div>
								<Separator />
								<div className="space-y-5">
									<div className="flex items-start gap-3">
										<Switch
											checked={enabled}
											onCheckedChange={(value) => {
												setEnabled(value);
												track("sdk_sessions", String(value));
											}}
											aria-label="Enable end-user sessions"
										/>
										<div className="space-y-1">
											<Label>Enable end-user sessions</Label>
											<p className="text-sm text-muted-foreground">
												Allow this project to mint short-lived browser session
												tokens.
											</p>
										</div>
									</div>
									<div className="grid gap-2 sm:max-w-56">
										<Label htmlFor="demo-markup">Markup percent</Label>
										<Input
											id="demo-markup"
											type="number"
											defaultValue={SDK_SETTINGS.markupPercent}
										/>
									</div>
									<div className="grid gap-2 sm:max-w-56">
										<Label htmlFor="demo-bonus">Top-up bonus percent</Label>
										<Input
											id="demo-bonus"
											type="number"
											defaultValue={SDK_SETTINGS.bonusPercent}
										/>
									</div>
									<Field
										id="demo-origins"
										label="Allowed origins"
										hint="One browser origin per line."
										wide
									>
										<Textarea
											id="demo-origins"
											defaultValue={SDK_SETTINGS.allowedOrigins.join("\n")}
											className="min-h-28 font-mono text-sm"
										/>
									</Field>
									<Separator />
									<div>
										<h4 className="font-medium">Receipts &amp; branding</h4>
										<p className="text-sm text-muted-foreground">
											LLM Gateway is the merchant of record and stays on every
											receipt. These fields tell your end-users which product
											the charge came from.
										</p>
									</div>
									<Field
										id="demo-brand"
										label="Brand name"
										hint="Shown on the end-user's receipt. Defaults to the project name."
									>
										<Input
											id="demo-brand"
											defaultValue={SDK_SETTINGS.brandName}
										/>
									</Field>
									<Field
										id="demo-support-email"
										label="Support email"
										hint="Where end-users should write about a purchase. Leave empty to show only ours."
									>
										<Input
											id="demo-support-email"
											type="email"
											defaultValue={SDK_SETTINGS.supportEmail}
										/>
									</Field>
									<Field id="demo-descriptor" label="Statement descriptor">
										<Input
											id="demo-descriptor"
											defaultValue={SDK_SETTINGS.descriptorSuffix}
											className="font-mono"
										/>
									</Field>
									<div className="flex justify-end">
										<Button onClick={() => notify(READ_ONLY_MESSAGE)}>
											Save Settings
										</Button>
									</div>
								</div>
							</section>

							<section className="space-y-4">
								<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
									<div>
										<h3 className="text-lg font-medium">
											Platform Secret Keys
										</h3>
										<p className="text-sm text-muted-foreground">
											Server-side keys for minting end-user sessions.
										</p>
									</div>
									<div className="flex flex-col gap-2 sm:flex-row">
										<Button
											variant="outline"
											onClick={() => notify(READ_ONLY_MESSAGE)}
										>
											<KeyRound className="h-4 w-4" />
											Create Test Key
										</Button>
										<Button onClick={() => notify(READ_ONLY_MESSAGE)}>
											<KeyRound className="h-4 w-4" />
											Create Live Key
										</Button>
									</div>
								</div>
								<Separator />
								<div className="space-y-3">
									{SDK_SETTINGS.platformKeys.map((key) => (
										<div
											key={key.id}
											className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
										>
											<div className="min-w-0 space-y-1">
												<div className="flex items-center gap-2">
													<p className="font-medium">{key.description}</p>
													{key.mode === "test" && (
														<span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
															test
														</span>
													)}
													<span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
														active
													</span>
												</div>
												<p className="truncate font-mono text-xs text-muted-foreground">
													{key.maskedToken}
												</p>
											</div>
											<Button
												variant="outline"
												size="sm"
												onClick={() => notify(READ_ONLY_MESSAGE)}
											>
												<Trash2 className="h-4 w-4" />
												Revoke
											</Button>
										</div>
									))}
								</div>
							</section>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
