"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, Plug, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useConnectors } from "@/hooks/use-connectors";
import { useFetchClient } from "@/lib/fetch-client";

import type { LoungeConnectorId } from "@llmgateway/shared/lounge-connectors";

type ConnectorAction = { id: LoungeConnectorId } & (
	| { action: "connect" }
	| { action: "disconnect" }
	| { action: "toggle"; enabled: boolean }
);

export function ConnectorsDialog() {
	const searchParams = useSearchParams();
	const [open, setOpen] = useState(
		Boolean(searchParams.get("connector_status")),
	);
	const [search, setSearch] = useState("");
	const [shop, setShop] = useState("");
	const { data, isPending, error, refetch } = useConnectors();
	const client = useFetchClient();
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: async (action: ConnectorAction) => {
			const params = { path: { connectorId: action.id } };
			if (action.action === "connect") {
				const returnUrl = new URL(window.location.href);
				returnUrl.searchParams.delete("connector");
				returnUrl.searchParams.delete("connector_status");
				const response = await client.POST(
					"/connectors/{connectorId}/authorize",
					{
						params,
						body: {
							returnTo: returnUrl.pathname + returnUrl.search,
							...(action.id === "shopify" ? { shop } : {}),
						},
					},
				);
				if (!response.data) {
					throw new Error(
						response.error?.message ??
							"Could not start authorization. Please try again.",
					);
				}
				window.location.assign(response.data.url);
			} else if (action.action === "disconnect") {
				const response = await client.DELETE("/connectors/{connectorId}", {
					params,
				});
				if (!response.data) {
					throw new Error("Could not disconnect. Please try again.");
				}
			} else {
				const response = await client.PATCH("/connectors/{connectorId}", {
					params,
					body: { enabled: action.enabled },
				});
				if (!response.data) {
					throw new Error("Could not update this connector. Please try again.");
				}
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["get", "/connectors"] });
		},
		onError: (error) => toast.error(error.message),
	});
	const enabledCount =
		data?.connectors.filter(
			(connector) =>
				connector.available && connector.connected && connector.enabled,
		).length ?? 0;
	const connectors = data?.connectors.filter((connector) =>
		`${connector.name} ${connector.description}`
			.toLowerCase()
			.includes(search.toLowerCase()),
	);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					aria-label="Connectors"
					className="gap-2"
				>
					<Plug className="size-4" />
					<span className="hidden sm:inline">Connectors</span>
					{enabledCount > 0 && (
						<span className="bg-primary/10 text-primary rounded-full px-1.5 text-xs tabular-nums">
							{enabledCount}
						</span>
					)}
				</Button>
			</DialogTrigger>
			<DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
				<DialogHeader className="shrink-0 space-y-3 border-b px-6 pt-6 pb-5">
					<div className="text-primary flex items-center gap-2 text-xs font-medium uppercase tracking-widest">
						<Plug className="size-3.5" /> Your workspace, at the table
					</div>
					<DialogTitle className="text-2xl">Connectors</DialogTitle>
					<DialogDescription>
						Bring context from your apps into The Lounge. Connect an account,
						then ask about it here. You review tool calls before they run.
					</DialogDescription>
				</DialogHeader>
				<div className="shrink-0 px-6 pt-4">
					{searchParams.get("connector_status") === "failed" && (
						<p role="alert" className="text-destructive mb-3 text-sm">
							Could not finish connecting. Please try again.
						</p>
					)}
					{searchParams.get("connector_status") === "connected" && (
						<p role="status" className="mb-3 flex items-center gap-2 text-sm">
							<Check className="text-primary size-4" /> Your account is
							connected.
						</p>
					)}
					{searchParams.get("connector_status") === "cancelled" && (
						<p role="status" className="text-muted-foreground mb-3 text-sm">
							Connection cancelled. You can try again whenever you’re ready.
						</p>
					)}
					<div className="relative">
						<Search className="text-muted-foreground absolute top-2.5 left-3 size-4" />
						<Input
							aria-label="Search connectors"
							placeholder="Find an app…"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							className="pl-9"
						/>
					</div>
				</div>
				<div className="min-h-0 max-h-[52dvh] overflow-y-auto px-6 py-2">
					{isPending && (
						<p
							role="status"
							className="text-muted-foreground py-8 text-center text-sm"
						>
							Loading connectors…
						</p>
					)}
					{error && (
						<div role="alert" className="py-8 text-center text-sm">
							<p>Could not load your connectors.</p>
							<Button
								variant="outline"
								className="mt-3"
								onClick={() => void refetch()}
							>
								Try again
							</Button>
						</div>
					)}
					{connectors?.map((connector) => {
						const busy =
							mutation.isPending && mutation.variables.id === connector.id;
						return (
							<div
								key={connector.id}
								className="border-border/70 border-b py-4 last:border-0"
							>
								<div className="flex items-center gap-3">
									<div
										aria-hidden="true"
										className="bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-xl border text-sm font-semibold"
									>
										{connector.name.slice(0, 2)}
									</div>
									<div className="min-w-0 flex-1">
										<h3 className="text-sm font-medium">{connector.name}</h3>
										<p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
											{connector.description}
										</p>
									</div>
									{connector.connected ? (
										<Switch
											aria-label={`Use ${connector.name} in chats`}
											checked={connector.available && connector.enabled}
											disabled={!connector.available || mutation.isPending}
											onCheckedChange={(enabled) =>
												mutation.mutate({
													action: "toggle",
													id: connector.id,
													enabled,
												})
											}
										/>
									) : (
										<Button
											variant="outline"
											size="sm"
											disabled={
												!connector.available ||
												mutation.isPending ||
												(connector.id === "shopify" && !shop)
											}
											onClick={() =>
												mutation.mutate({ action: "connect", id: connector.id })
											}
										>
											{busy ? (
												<Loader2 className="size-3.5 animate-spin" />
											) : connector.available ? (
												<ExternalLink className="size-3.5" />
											) : null}
											{connector.available ? "Connect" : "Not configured"}
										</Button>
									)}
								</div>
								{connector.id === "shopify" &&
									!connector.connected &&
									connector.available && (
										<div className="mt-3 ml-13">
											<Label htmlFor="connector-shop" className="text-xs">
												Store domain
											</Label>
											<Input
												id="connector-shop"
												placeholder="your-store.myshopify.com"
												value={shop}
												onChange={(event) =>
													setShop(event.target.value.trim().toLowerCase())
												}
												className="mt-1"
											/>
										</div>
									)}
								{connector.connected && (
									<div className="mt-2 ml-13 flex items-center gap-3">
										<span className="text-muted-foreground text-xs">
											{!connector.available
												? "Not configured"
												: connector.enabled
													? "Active in chats"
													: "Paused"}
										</span>
										<button
											type="button"
											disabled={!connector.available || mutation.isPending}
											onClick={() =>
												mutation.mutate({ action: "connect", id: connector.id })
											}
											className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
										>
											Reconnect
										</button>
										<button
											type="button"
											disabled={mutation.isPending}
											onClick={() =>
												mutation.mutate({
													action: "disconnect",
													id: connector.id,
												})
											}
											className="text-muted-foreground hover:text-destructive text-xs underline underline-offset-4"
										>
											Disconnect
										</button>
									</div>
								)}
							</div>
						);
					})}
					{connectors?.length === 0 && (
						<p className="text-muted-foreground py-8 text-center text-sm">
							No apps match your search.
						</p>
					)}
				</div>
				<p className="text-muted-foreground bg-muted/30 shrink-0 border-t px-6 py-4 text-xs leading-relaxed">
					Connections are private to your account. Results you use in a chat
					become part of that conversation and are sent to the selected model.
				</p>
			</DialogContent>
		</Dialog>
	);
}
