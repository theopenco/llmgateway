"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

interface ProjectNameSettingsProps {
	projectId: string;
	orgId: string;
	initialName: string;
}

export function ProjectNameSettings({
	projectId,
	orgId,
	initialName,
}: ProjectNameSettingsProps) {
	const queryClient = useQueryClient();
	const api = useApi();

	const [name, setName] = useState(initialName);
	const [nameError, setNameError] = useState("");

	const updateProject = api.useMutation("patch", "/projects/{id}", {
		onSuccess: async () => {
			const queryKey = api.queryOptions("get", "/orgs/{id}/projects", {
				params: { path: { id: orgId } },
			}).queryKey;
			await queryClient.invalidateQueries({ queryKey });
		},
	});

	const handleSave = async () => {
		if (!name.trim()) {
			setNameError("Project name is required");
			return;
		}

		if (name.length > 255) {
			setNameError("Project name must be less than 255 characters");
			return;
		}

		setNameError("");

		try {
			await updateProject.mutateAsync({
				params: { path: { id: projectId } },
				body: { name: name.trim() },
			});

			toast({
				title: "Settings saved",
				description: "Your project name has been updated.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save project name.",
				variant: "destructive",
			});
		}
	};

	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<Label htmlFor="projectName">Name</Label>
				<Input
					id="projectName"
					type="text"
					placeholder="My Project"
					value={name}
					onChange={(e) => {
						setName(e.target.value);
						setNameError("");
					}}
					className={nameError ? "border-destructive max-w-md" : "max-w-md"}
				/>
				{nameError && <p className="text-sm text-destructive">{nameError}</p>}
				<p className="text-sm text-muted-foreground">
					This name will be displayed throughout the platform.
				</p>
			</div>
			<div className="flex justify-end">
				<Button onClick={handleSave} disabled={updateProject.isPending}>
					{updateProject.isPending ? "Saving..." : "Save Settings"}
				</Button>
			</div>
		</div>
	);
}
