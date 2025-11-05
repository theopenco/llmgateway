"use client";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { Separator } from "@/lib/components/separator";
import { toast } from "@/lib/components/use-toast";
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";

export function OrganizationNameSettings() {
	const queryClient = useQueryClient();
	const { selectedOrganization } = useDashboardState();

	const api = useApi();
	const updateOrganization = api.useMutation("patch", "/orgs/{id}", {
		onSuccess: async () => {
			const queryKey = api.queryOptions("get", "/orgs").queryKey;
			await queryClient.refetchQueries({ queryKey });
		},
	});

	const [name, setName] = useState<string>(selectedOrganization?.name || "");

	const [nameError, setNameError] = useState<string>("");

	React.useEffect(() => {
		setName(selectedOrganization?.name || "");
		setNameError("");
	}, [selectedOrganization?.id, selectedOrganization?.name]);

	if (!selectedOrganization) {
		return (
			<div className="space-y-2">
				<h3 className="text-lg font-medium">Organization Name</h3>
				<p className="text-muted-foreground text-sm">
					Please select an organization to configure name settings.
				</p>
			</div>
		);
	}

	const handleSave = async () => {
		if (!name.trim()) {
			setNameError("Organization name is required");
			return;
		}

		if (name.length > 255) {
			setNameError("Organization name must be less than 255 characters");
			return;
		}

		setNameError("");

		try {
			await updateOrganization.mutateAsync({
				params: { path: { id: selectedOrganization.id } },
				body: { name: name.trim() },
			});

			toast({
				title: "Settings saved",
				description: "Your organization name has been updated.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save organization name settings.",
				variant: "destructive",
			});
		}
	};

	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-lg font-medium">Organization Name</h3>
				<p className="text-muted-foreground text-sm">
					Update your organization's display name
				</p>
			</div>

			<Separator />

			<div className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="orgName">Name</Label>
					<Input
						id="orgName"
						type="text"
						placeholder="My Organization"
						value={name}
						onChange={(e) => {
							setName(e.target.value);
							setNameError("");
						}}
						className={nameError ? "border-destructive" : ""}
					/>
					{nameError && <p className="text-sm text-destructive">{nameError}</p>}
					<p className="text-sm text-muted-foreground">
						This name will be displayed throughout the platform.
					</p>
				</div>
			</div>

			<div className="flex justify-end">
				<Button onClick={handleSave} disabled={updateOrganization.isPending}>
					{updateOrganization.isPending ? "Saving..." : "Save Settings"}
				</Button>
			</div>
		</div>
	);
}
