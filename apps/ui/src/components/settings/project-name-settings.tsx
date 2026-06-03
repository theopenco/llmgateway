"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
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
	const [copied, setCopied] = useState(false);

	const copyProjectId = async () => {
		try {
			await navigator.clipboard.writeText(projectId);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error("Failed to copy:", err);
		}
	};

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
			<div className="space-y-2">
				<Label htmlFor="projectId">Project ID</Label>
				<div className="flex items-center gap-2 max-w-md">
					<Input
						id="projectId"
						type="text"
						value={projectId}
						readOnly
						className="font-mono"
					/>
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={copyProjectId}
						aria-label="Copy project ID"
					>
						{copied ? (
							<Check className="h-4 w-4 text-green-600" />
						) : (
							<Copy className="h-4 w-4" />
						)}
					</Button>
				</div>
			</div>
			<div className="flex justify-end">
				<Button onClick={handleSave} disabled={updateProject.isPending}>
					{updateProject.isPending ? "Saving..." : "Save Settings"}
				</Button>
			</div>
		</div>
	);
}
