"use client";

import { useState } from "react";

import { ReadonlyIdField } from "@/components/settings/readonly-id-field";
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
import { RadioGroup, RadioGroupItem } from "@/lib/components/radio-group";
import { Separator } from "@/lib/components/separator";
import { Switch } from "@/lib/components/switch";

import { READ_ONLY_MESSAGE, useDemo } from "./context";

const PROJECT_MODES = [
	{
		id: "api-keys",
		label: "API Keys",
		desc: "Use your own provider API keys (OpenAI, Anthropic, etc.)",
	},
	{
		id: "credits",
		label: "Credits",
		desc: "Use your organization credits and our internal API keys",
	},
	{
		id: "hybrid",
		label: "Hybrid",
		desc: "Use your own API keys when available, fall back to credits when needed",
	},
];

const CACHE_CONTROL_OPTIONS = [
	{
		value: "auto",
		label: "Automatic",
		description:
			"Forward the cache markers your client sends and add markers on long prompts that have none. Best when your requests do not manage caching themselves.",
	},
	{
		value: "passthrough",
		label: "Client-managed",
		description:
			"Forward your client's markers untouched and never add any. A request writes to the provider cache only when it asked to.",
	},
	{
		value: "off",
		label: "Disabled",
		description:
			"Strip every marker, including ones your client sends. No cache writes and no cache reads for this project.",
	},
];

function SectionHeading({ title, body }: { title: string; body: string }) {
	const { project } = useDemo();
	return (
		<div>
			<h3 className="text-lg font-medium">{title}</h3>
			<p className="text-sm text-muted-foreground">{body}</p>
			<p className="mt-1 text-sm text-muted-foreground">
				Project: {project.name}
			</p>
		</div>
	);
}

function SaveButton() {
	const { notify } = useDemo();
	return (
		<div className="flex justify-end">
			<Button type="button" onClick={() => notify(READ_ONLY_MESSAGE)}>
				Save Settings
			</Button>
		</div>
	);
}

export function PreferencesView() {
	const { notify, project, track } = useDemo();
	const [name, setName] = useState(project.name);
	const [mode, setMode] = useState("hybrid");
	const [caching, setCaching] = useState(true);
	const [cacheControl, setCacheControl] = useState("auto");

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="mx-auto max-w-3xl space-y-6">
					<h2 className="text-3xl font-bold tracking-tight">Preferences</h2>
					<Card>
						<CardHeader>
							<CardTitle>Project ID</CardTitle>
							<CardDescription>
								Use this ID when referencing your project in the API or with
								support.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ReadonlyIdField
								id="projectId"
								value={project.id}
								copyAriaLabel="Copy project ID"
							/>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Project Name</CardTitle>
							<CardDescription>
								Update your project's display name
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="demo-project-name">Name</Label>
								<Input
									id="demo-project-name"
									value={name}
									onChange={(event) => setName(event.target.value)}
									className="max-w-md"
								/>
							</div>
							<SaveButton />
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Project Mode</CardTitle>
							<CardDescription>
								Configure how your organization handles projects
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<SectionHeading
								title="Project Mode"
								body="Configure how your project consumes LLM services"
							/>
							<Separator />
							<RadioGroup
								value={mode}
								onValueChange={(value) => {
									setMode(value);
									track("project_mode", value);
								}}
								className="space-y-2"
							>
								{PROJECT_MODES.map(({ id, label, desc }) => (
									<div key={id} className="flex items-start space-x-2">
										<RadioGroupItem value={id} id={`demo-mode-${id}`} />
										<div className="flex-1 space-y-1">
											<Label
												htmlFor={`demo-mode-${id}`}
												className="font-medium"
											>
												{label}
											</Label>
											<p className="text-sm text-muted-foreground">{desc}</p>
										</div>
									</div>
								))}
							</RadioGroup>
							<SaveButton />
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Caching</CardTitle>
							<CardDescription>
								Configure caching settings for your API requests
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<SectionHeading
								title="Request Caching"
								body="Configure caching for identical LLM requests"
							/>
							<Separator />
							<div className="flex flex-row items-start space-x-3">
								<Switch
									id="demo-caching"
									checked={caching}
									onCheckedChange={(value) => {
										setCaching(value);
										track("caching", String(value));
									}}
								/>
								<Label htmlFor="demo-caching">Enable request caching</Label>
							</div>
							<div className="space-y-2">
								<Label htmlFor="demo-cache-duration">
									Cache Duration (seconds)
								</Label>
								<Input
									id="demo-cache-duration"
									type="number"
									defaultValue={3600}
									disabled={!caching}
									className="w-32"
								/>
								<p className="text-sm text-muted-foreground">
									Min: 10, Max: 31,536,000 (one year)
								</p>
							</div>
							<Separator />
							<div>
								<h4 className="text-base font-medium">Provider Cache Writes</h4>
								<p className="text-sm text-muted-foreground">
									Applies to providers that support explicit prompt-cache
									markers
								</p>
							</div>
							<RadioGroup
								value={cacheControl}
								onValueChange={(value) => {
									setCacheControl(value);
									track("cache_control", value);
								}}
								className="gap-3"
							>
								{CACHE_CONTROL_OPTIONS.map((option) => (
									<div
										key={option.value}
										className="flex flex-row items-start space-x-3"
									>
										<RadioGroupItem
											value={option.value}
											id={`demo-cache-${option.value}`}
											className="mt-1"
										/>
										<div className="space-y-1 leading-none">
											<Label htmlFor={`demo-cache-${option.value}`}>
												{option.label}
											</Label>
											<p className="text-sm text-muted-foreground">
												{option.description}
											</p>
										</div>
									</div>
								))}
							</RadioGroup>
							<SaveButton />
						</CardContent>
					</Card>

					<Card className="border-destructive/20">
						<CardHeader>
							<CardTitle className="text-destructive">Danger Zone</CardTitle>
							<CardDescription>
								Irreversible and destructive actions
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<SectionHeading
								title="Archive Project"
								body="Permanently archive this project and all its data"
							/>
							<Separator />
							<div className="flex justify-end">
								<Button
									variant="destructive"
									onClick={() => notify(READ_ONLY_MESSAGE)}
								>
									Archive Project
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
