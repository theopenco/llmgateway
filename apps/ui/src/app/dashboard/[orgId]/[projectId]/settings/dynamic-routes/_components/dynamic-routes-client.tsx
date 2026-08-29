"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Mail, Plus, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { Badge } from "@/lib/components/badge";
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
import { Switch } from "@/lib/components/switch";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/lib/components/tabs";
import { Textarea } from "@/lib/components/textarea";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import { Time } from "@llmgateway/shared";

import { validateGraphText } from "./flow-graph";

import type { DynamicRouteGraph } from "@llmgateway/shared/dynamic-route";

const RouteFlowEditor = dynamic(
	() => import("./route-flow-editor").then((m) => m.RouteFlowEditor),
	{
		ssr: false,
		loading: () => (
			<div className="flex h-[480px] items-center justify-center rounded-md border text-sm text-muted-foreground">
				Loading editor…
			</div>
		),
	},
);

/** Loose shape check so the visual editor can initialize from a draft that
 * parses as JSON even when it is not (yet) schema-valid. */
function asEditableGraph(text: string): DynamicRouteGraph | null {
	try {
		const raw = JSON.parse(text) as DynamicRouteGraph;
		if (
			raw &&
			typeof raw === "object" &&
			typeof raw.entry === "string" &&
			Array.isArray(raw.nodes)
		) {
			return raw;
		}
		return null;
	} catch {
		return null;
	}
}

const STARTER_GRAPH = {
	entry: "split",
	nodes: [
		{
			id: "split",
			type: "percentage",
			splits: [
				{ weight: 90, next: "main" },
				{ weight: 10, next: "experiment" },
			],
		},
		{ id: "main", type: "model", model: "gpt-5-nano" },
		{ id: "experiment", type: "model", model: "gemini-2.5-flash" },
	],
};

function ContactSalesCard() {
	return (
		<Card className="max-w-2xl">
			<CardHeader>
				<CardTitle>Enterprise Feature</CardTitle>
				<CardDescription>
					Dynamic routes are available on the Enterprise plan
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<p className="text-muted-foreground">
					Define named routing flows and invoke them by putting
					<code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">
						dynamic/&lt;name&gt;
					</code>
					in the model field. Branch on headers, body fields, or request
					metadata, run percentage-based A/B splits, and publish versioned
					graphs with instant rollback.
				</p>
				<div className="space-y-3">
					<h4 className="font-medium">What&apos;s included:</h4>
					<ul className="space-y-2">
						<li className="flex items-center gap-2 text-sm text-muted-foreground">
							<CheckCircle className="h-4 w-4 text-primary" />
							Conditional routing on headers, body fields, and request metadata
						</li>
						<li className="flex items-center gap-2 text-sm text-muted-foreground">
							<CheckCircle className="h-4 w-4 text-primary" />
							Session-sticky percentage splits for A/B tests and gradual
							rollouts
						</li>
						<li className="flex items-center gap-2 text-sm text-muted-foreground">
							<CheckCircle className="h-4 w-4 text-primary" />
							Versioned publishing with instant rollback
						</li>
						<li className="flex items-center gap-2 text-sm text-muted-foreground">
							<CheckCircle className="h-4 w-4 text-primary" />
							Automatic provider fallback and smart routing per target model
						</li>
					</ul>
				</div>
				<Button asChild className="gap-2">
					<a href="mailto:contact@llmgateway.io?subject=Enterprise%20Plan%20Inquiry%20-%20Dynamic%20Routes">
						<Mail className="h-4 w-4" />
						Contact Sales
					</a>
				</Button>
			</CardContent>
		</Card>
	);
}

export function DynamicRoutesClient({ projectId }: { projectId: string }) {
	const api = useApi();
	const queryClient = useQueryClient();
	const { selectedOrganization } = useDashboardNavigation();
	const { user } = useUser();
	const { data: teamData } = useTeamMembers(selectedOrganization?.id ?? "");

	const role = teamData?.members.find((m) => m.userId === user?.id)?.role;
	const canManage =
		selectedOrganization?.enterpriseAccess === true &&
		(role === "owner" || role === "admin");

	const [selectedName, setSelectedName] = useState<string | null>(null);
	const [newName, setNewName] = useState("");
	const [draftText, setDraftText] = useState<string | null>(null);
	const [draftError, setDraftError] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState<"visual" | "json">("visual");
	const [visualErrors, setVisualErrors] = useState<string[]>([]);
	// Bumped whenever the visual tab (re)opens so the flow editor remounts and
	// re-reads the latest draft text (which the JSON tab may have changed).
	const [visualSession, setVisualSession] = useState(0);

	const listQuery = api.useQuery(
		"get",
		"/dynamic-routes/{projectId}",
		{ params: { path: { projectId } } },
		{ enabled: canManage },
	);

	const detailQuery = api.useQuery(
		"get",
		"/dynamic-routes/{projectId}/{name}",
		{ params: { path: { projectId, name: selectedName ?? "" } } },
		{ enabled: canManage && !!selectedName },
	);

	const versionsQuery = api.useQuery(
		"get",
		"/dynamic-routes/{projectId}/{name}/versions",
		{ params: { path: { projectId, name: selectedName ?? "" } } },
		{ enabled: canManage && !!selectedName },
	);

	const invalidateAll = () => {
		void queryClient.invalidateQueries({
			queryKey: api.queryOptions("get", "/dynamic-routes/{projectId}", {
				params: { path: { projectId } },
			}).queryKey,
		});
		if (selectedName) {
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions(
					"get",
					"/dynamic-routes/{projectId}/{name}",
					{ params: { path: { projectId, name: selectedName } } },
				).queryKey,
			});
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions(
					"get",
					"/dynamic-routes/{projectId}/{name}/versions",
					{ params: { path: { projectId, name: selectedName } } },
				).queryKey,
			});
		}
	};

	const createMutation = api.useMutation(
		"post",
		"/dynamic-routes/{projectId}",
		{
			onSuccess: (data) => {
				invalidateAll();
				setNewName("");
				setSelectedName(data.name);
				setDraftText(null);
				setDraftError(null);
				toast({ title: `Route "${data.name}" created` });
			},
			onError: (error) => {
				toast({
					title: "Failed to create route",
					description: String(
						(error as { message?: string })?.message ?? error,
					),
					variant: "destructive",
				});
			},
		},
	);

	const draftMutation = api.useMutation(
		"put",
		"/dynamic-routes/{projectId}/{name}/draft",
		{
			onSuccess: () => {
				invalidateAll();
				toast({ title: "Draft saved" });
			},
			onError: (error) => {
				toast({
					title: "Failed to save draft",
					description: String(
						(error as { message?: string })?.message ?? error,
					),
					variant: "destructive",
				});
			},
		},
	);

	const publishMutation = api.useMutation(
		"post",
		"/dynamic-routes/{projectId}/{name}/publish",
		{
			onSuccess: (data) => {
				invalidateAll();
				toast({
					title: `Published version ${data.publishedVersion?.version}`,
				});
			},
			onError: (error) => {
				toast({
					title: "Failed to publish",
					description: String(
						(error as { message?: string })?.message ?? error,
					),
					variant: "destructive",
				});
			},
		},
	);

	const rollbackMutation = api.useMutation(
		"post",
		"/dynamic-routes/{projectId}/{name}/rollback",
		{
			onSuccess: () => {
				invalidateAll();
				toast({ title: "Published version updated" });
			},
			onError: (error) => {
				toast({
					title: "Failed to change published version",
					description: String(
						(error as { message?: string })?.message ?? error,
					),
					variant: "destructive",
				});
			},
		},
	);

	const patchMutation = api.useMutation(
		"patch",
		"/dynamic-routes/{projectId}/{name}",
		{
			onSuccess: () => {
				invalidateAll();
			},
			onError: (error) => {
				toast({
					title: "Failed to update route",
					description: String(
						(error as { message?: string })?.message ?? error,
					),
					variant: "destructive",
				});
			},
		},
	);

	const deleteMutation = api.useMutation(
		"delete",
		"/dynamic-routes/{projectId}/{name}",
		{
			onSuccess: () => {
				invalidateAll();
				setSelectedName(null);
				setDraftText(null);
				toast({ title: "Route deleted" });
			},
			onError: (error) => {
				toast({
					title: "Failed to delete route",
					description: String(
						(error as { message?: string })?.message ?? error,
					),
					variant: "destructive",
				});
			},
		},
	);

	if (!canManage) {
		return (
			<div className="flex flex-col">
				<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
					<div className="max-w-4xl mx-auto space-y-6">
						<div>
							<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
								Dynamic Routes
							</h2>
							<p className="text-sm text-muted-foreground">
								Named, versioned routing flows invoked via the model field.
							</p>
						</div>
						<ContactSalesCard />
					</div>
				</div>
			</div>
		);
	}

	const routes = listQuery.data?.routes ?? [];
	const detail = detailQuery.data;
	// Fall back to the live published graph before the starter template so a
	// route with a cleared draft shows what actually serves traffic instead of
	// inviting the user to publish the template over it.
	const fallbackGraph =
		detail?.draftGraph ?? detail?.publishedVersion?.graph ?? STARTER_GRAPH;
	const effectiveDraftText =
		draftText ?? JSON.stringify(fallbackGraph, null, 2);
	// Same validation the API applies on save/publish; saving is blocked until
	// the draft passes so an invalid graph can never be stored.
	const jsonErrors = selectedName ? validateGraphText(effectiveDraftText) : [];
	const draftErrors = activeTab === "visual" ? visualErrors : jsonErrors;
	const editableGraph = asEditableGraph(effectiveDraftText);

	const handleSaveDraft = () => {
		if (!selectedName || draftErrors.length > 0) {
			return;
		}
		let graph: unknown;
		try {
			graph = JSON.parse(effectiveDraftText);
		} catch (error) {
			setDraftError(`Invalid JSON: ${String(error)}`);
			return;
		}
		setDraftError(null);
		draftMutation.mutate({
			params: { path: { projectId, name: selectedName } },
			body: { graph: graph as never },
		});
	};

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="max-w-6xl mx-auto space-y-6">
					<div>
						<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
							Dynamic Routes
						</h2>
						<p className="text-sm text-muted-foreground">
							Define named routing flows and invoke them with{" "}
							<code className="rounded bg-muted px-1.5 py-0.5 text-xs">
								&quot;model&quot;: &quot;dynamic/&lt;name&gt;&quot;
							</code>
							. Conditions branch on headers, body fields, and request metadata;
							percentage splits are sticky per session.
						</p>
					</div>

					<div className="grid gap-6 lg:grid-cols-[280px_1fr]">
						<div className="space-y-4">
							<Card>
								<CardHeader>
									<CardTitle className="text-base">Routes</CardTitle>
								</CardHeader>
								<CardContent className="space-y-2">
									{listQuery.isLoading ? (
										<p className="text-sm text-muted-foreground">Loading…</p>
									) : routes.length === 0 ? (
										<p className="text-sm text-muted-foreground">
											No routes yet.
										</p>
									) : (
										routes.map((route) => (
											<button
												key={route.id}
												type="button"
												onClick={() => {
													setSelectedName(route.name);
													setDraftText(null);
													setDraftError(null);
												}}
												className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
													selectedName === route.name
														? "border-primary bg-accent"
														: "border-border"
												}`}
											>
												<div className="flex items-center justify-between gap-2">
													<span className="font-medium">{route.name}</span>
													<span className="flex items-center gap-1">
														{route.publishedVersion ? (
															<Badge variant="secondary">
																v{route.publishedVersion.version}
															</Badge>
														) : (
															<Badge variant="outline">unpublished</Badge>
														)}
														{!route.enabled && (
															<Badge variant="destructive">off</Badge>
														)}
													</span>
												</div>
											</button>
										))
									)}
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle className="text-base">New route</CardTitle>
								</CardHeader>
								<CardContent className="space-y-3">
									<div className="space-y-1">
										<Label htmlFor="new-route-name">Name</Label>
										<Input
											id="new-route-name"
											placeholder="support"
											value={newName}
											onChange={(e) => setNewName(e.target.value.toLowerCase())}
										/>
									</div>
									<Button
										className="w-full gap-2"
										disabled={!newName || createMutation.isPending}
										onClick={() =>
											createMutation.mutate({
												params: { path: { projectId } },
												body: {
													name: newName,
													graph: STARTER_GRAPH as never,
												},
											})
										}
									>
										<Plus className="h-4 w-4" />
										Create
									</Button>
								</CardContent>
							</Card>
						</div>

						{selectedName && detail ? (
							<div className="space-y-4">
								<Card>
									<CardHeader className="flex flex-row items-center justify-between space-y-0">
										<div>
											<CardTitle className="text-base">
												dynamic/{detail.name}
											</CardTitle>
											<CardDescription>
												{detail.publishedVersion
													? `Published: v${detail.publishedVersion.version}`
													: "Not published yet — requests will fail until you publish"}
											</CardDescription>
										</div>
										<div className="flex items-center gap-3">
											<div className="flex items-center gap-2">
												<Label
													htmlFor="route-enabled"
													className="text-sm text-muted-foreground"
												>
													Enabled
												</Label>
												<Switch
													id="route-enabled"
													checked={detail.enabled}
													onCheckedChange={(checked) =>
														patchMutation.mutate({
															params: {
																path: { projectId, name: detail.name },
															},
															body: { enabled: checked },
														})
													}
												/>
											</div>
											<Button
												variant="ghost"
												size="icon"
												aria-label="Delete route"
												onClick={() => {
													if (
														window.confirm(
															`Delete route "${detail.name}"? Requests using dynamic/${detail.name} will fail.`,
														)
													) {
														deleteMutation.mutate({
															params: {
																path: { projectId, name: detail.name },
															},
														});
													}
												}}
											>
												<Trash2 className="h-4 w-4 text-destructive" />
											</Button>
										</div>
									</CardHeader>
									<CardContent className="space-y-3">
										<Tabs
											value={activeTab}
											onValueChange={(value) => {
												if (value === "visual") {
													if (!editableGraph) {
														setDraftError(
															"Fix the JSON before switching to the visual editor",
														);
														return;
													}
													setVisualSession((s) => s + 1);
												}
												setDraftError(null);
												setActiveTab(value as "visual" | "json");
											}}
										>
											<TabsList>
												<TabsTrigger value="visual">Visual</TabsTrigger>
												<TabsTrigger value="json">JSON</TabsTrigger>
											</TabsList>
											<TabsContent value="visual" className="mt-3">
												{editableGraph ? (
													<RouteFlowEditor
														key={`${detail.id}:${visualSession}`}
														initialGraph={editableGraph}
														onGraphChange={(graph) => {
															setDraftText(JSON.stringify(graph, null, 2));
															setDraftError(null);
														}}
														onValidationChange={setVisualErrors}
													/>
												) : (
													<p className="text-sm text-muted-foreground">
														The draft JSON is invalid — fix it in the JSON tab
														first.
													</p>
												)}
											</TabsContent>
											<TabsContent value="json" className="mt-3">
												<div className="space-y-1">
													<Label htmlFor="draft-graph">
														Draft graph (JSON)
													</Label>
													<Textarea
														id="draft-graph"
														className="min-h-[360px] font-mono text-xs"
														value={effectiveDraftText}
														onChange={(e) => {
															setDraftText(e.target.value);
															setDraftError(null);
														}}
													/>
												</div>
											</TabsContent>
										</Tabs>
										{draftError ? (
											<p className="text-xs text-destructive">{draftError}</p>
										) : null}
										{draftErrors.length > 0 && (
											<div className="rounded-md border border-destructive/40 bg-destructive/5 p-2">
												<p className="mb-1 text-xs font-medium text-destructive">
													Fix before saving:
												</p>
												<ul className="list-disc space-y-0.5 pl-4 text-xs text-destructive">
													{draftErrors.slice(0, 8).map((error, index) => (
														<li key={index}>{error}</li>
													))}
													{draftErrors.length > 8 && (
														<li>…and {draftErrors.length - 8} more</li>
													)}
												</ul>
											</div>
										)}
										<div className="flex gap-2">
											<Button
												variant="outline"
												disabled={
													draftMutation.isPending || draftErrors.length > 0
												}
												onClick={handleSaveDraft}
											>
												Save draft
											</Button>
											<Button
												disabled={
													publishMutation.isPending || !detail.draftGraph
												}
												onClick={() =>
													publishMutation.mutate({
														params: {
															path: { projectId, name: detail.name },
														},
													})
												}
											>
												Publish
											</Button>
										</div>
										<p className="text-xs text-muted-foreground">
											Node types: <code>model</code> (target model + optional
											provider allowlist), <code>conditional</code> (ops: eq,
											neq, in, contains, gt, lt, exists on header / body /
											metadata fields), <code>percentage</code> (weighted
											splits), <code>end</code> (reject). Publishing snapshots
											the draft as a new immutable version.
										</p>
									</CardContent>
								</Card>

								<Card>
									<CardHeader>
										<CardTitle className="text-base">Versions</CardTitle>
										<CardDescription>
											Roll back by publishing a previous version.
										</CardDescription>
									</CardHeader>
									<CardContent className="space-y-2">
										{(versionsQuery.data?.versions ?? []).length === 0 ? (
											<p className="text-sm text-muted-foreground">
												No published versions yet.
											</p>
										) : (
											versionsQuery.data?.versions.map((version) => (
												<div
													key={version.id}
													className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
												>
													<div className="flex items-center gap-2">
														<span className="font-medium">
															v{version.version}
														</span>
														<span className="text-xs text-muted-foreground">
															<Time
																date={version.createdAt}
																format="monthDayYearHourMinuteZone"
															/>
														</span>
														{version.published && (
															<Badge variant="secondary">published</Badge>
														)}
													</div>
													<div className="flex items-center gap-2">
														<Button
															variant="ghost"
															size="sm"
															onClick={() => {
																setDraftText(
																	JSON.stringify(version.graph, null, 2),
																);
																setDraftError(null);
																// Remount the visual editor so it picks up the loaded version
																setVisualSession((s) => s + 1);
															}}
														>
															Load into draft
														</Button>
														{!version.published && (
															<Button
																variant="outline"
																size="sm"
																disabled={rollbackMutation.isPending}
																onClick={() =>
																	rollbackMutation.mutate({
																		params: {
																			path: {
																				projectId,
																				name: detail.name,
																			},
																		},
																		body: { versionId: version.id },
																	})
																}
															>
																Publish this
															</Button>
														)}
													</div>
												</div>
											))
										)}
									</CardContent>
								</Card>
							</div>
						) : (
							<Card>
								<CardContent className="flex h-full min-h-[200px] items-center justify-center">
									<p className="text-sm text-muted-foreground">
										Select a route or create a new one to edit its graph.
									</p>
								</CardContent>
							</Card>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
