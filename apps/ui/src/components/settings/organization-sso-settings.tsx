"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

interface OrganizationSsoSettingsProps {
	organizationId: string;
	savedDomain: string | null;
	isEnterprise: boolean;
	canManage: boolean;
}

function errorMessage(error: unknown, fallback: string): string {
	if (
		error &&
		typeof error === "object" &&
		"message" in error &&
		typeof (error as { message?: unknown }).message === "string"
	) {
		return (error as { message: string }).message;
	}
	return fallback;
}

export function OrganizationSsoSettings({
	organizationId,
	savedDomain,
	isEnterprise,
	canManage,
}: OrganizationSsoSettingsProps) {
	const queryClient = useQueryClient();
	const api = useApi();
	const updateOrganization = api.useMutation("patch", "/orgs/{id}", {
		onSuccess: async () => {
			const queryKey = api.queryOptions("get", "/orgs").queryKey;
			await queryClient.refetchQueries({ queryKey });
		},
	});

	const [domain, setDomain] = useState<string>(savedDomain ?? "");

	// Reset local edits when switching organizations so one org's domain doesn't
	// bleed into another.
	const loadedOrgId = useRef(organizationId);
	useEffect(() => {
		if (loadedOrgId.current !== organizationId) {
			loadedOrgId.current = organizationId;
			setDomain(savedDomain ?? "");
		}
	}, [organizationId, savedDomain]);

	if (!isEnterprise) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Google SSO auto-join</CardTitle>
					<CardDescription>
						Automatically add anyone who signs in with a Google account on your
						company's email domain to this organization. Available on the
						Enterprise plan —{" "}
						<a
							href="mailto:contact@llmgateway.io"
							className="underline underline-offset-4"
						>
							contact sales
						</a>{" "}
						to enable it.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const handleSave = async () => {
		const trimmed = domain.trim();
		try {
			await updateOrganization.mutateAsync({
				params: { path: { id: organizationId } },
				body: { ssoAutoJoinDomain: trimmed === "" ? null : trimmed },
			});
			toast({
				title: "Settings saved",
				description: trimmed
					? `People with a verified @${trimmed.replace(/^@/, "")} Google account will now auto-join this organization.`
					: "Google SSO auto-join has been disabled.",
			});
		} catch (error) {
			toast({
				title: "Error",
				description: errorMessage(
					error,
					"Failed to save SSO auto-join settings.",
				),
				variant: "destructive",
			});
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Google SSO auto-join</CardTitle>
				<CardDescription>
					When someone signs in with a Google account whose verified email
					matches this domain, they're automatically added to this organization
					as a developer. Leave empty to disable.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="ssoAutoJoinDomain">Email domain</Label>
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
						<Input
							id="ssoAutoJoinDomain"
							type="text"
							placeholder="acme.com"
							value={domain}
							disabled={!canManage}
							onChange={(e) => setDomain(e.target.value)}
							className="sm:max-w-sm"
						/>
						<Button
							onClick={handleSave}
							disabled={
								!canManage ||
								updateOrganization.isPending ||
								domain.trim() === (savedDomain ?? "")
							}
						>
							<Save className="mr-2 h-4 w-4" />
							{updateOrganization.isPending ? "Saving..." : "Save"}
						</Button>
					</div>
					<p className="text-muted-foreground text-sm">
						Consumer email domains (gmail.com, outlook.com, etc.) can't be used.
						A domain can only be claimed by one organization.
					</p>
					{!canManage && (
						<p className="text-muted-foreground text-sm">
							Only organization owners and admins can change this setting.
						</p>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
