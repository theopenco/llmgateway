"use client";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useRef, useState } from "react";

import { OrganizationAvatar } from "@/components/dashboard/organization-avatar";
import { Button } from "@/lib/components/button";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { Separator } from "@/lib/components/separator";
import { toast } from "@/lib/components/use-toast";
import { useDashboardContext } from "@/lib/dashboard-context";
import { useApi } from "@/lib/fetch-client";

// Logos are stored inline as small data URLs, so images are downscaled in the
// browser before upload. 256px is plenty for the sidebar switcher.
const LOGO_SIZE = 256;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

// Draws the image centered on a square canvas (cover crop) and returns a
// compact PNG data URL that fits the API's raster-only logo format.
async function fileToLogoDataUrl(file: File): Promise<string> {
	const objectUrl = URL.createObjectURL(file);
	try {
		const image = await new Promise<HTMLImageElement>((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error("Could not read this image"));
			img.src = objectUrl;
		});

		const canvas = document.createElement("canvas");
		canvas.width = LOGO_SIZE;
		canvas.height = LOGO_SIZE;
		const context = canvas.getContext("2d");
		if (!context) {
			throw new Error("Could not process this image");
		}

		const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
		const sourceX = (image.naturalWidth - cropSize) / 2;
		const sourceY = (image.naturalHeight - cropSize) / 2;
		context.drawImage(
			image,
			sourceX,
			sourceY,
			cropSize,
			cropSize,
			0,
			0,
			LOGO_SIZE,
			LOGO_SIZE,
		);

		return canvas.toDataURL("image/png");
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

export function OrganizationLogoSettings() {
	const queryClient = useQueryClient();
	const { selectedOrganization } = useDashboardContext();
	const fileInputRef = useRef<HTMLInputElement>(null);

	const api = useApi();
	const updateOrganization = api.useMutation("patch", "/orgs/{id}", {
		onSuccess: async () => {
			const queryKey = api.queryOptions("get", "/orgs").queryKey;
			await queryClient.refetchQueries({ queryKey });
		},
	});

	const [pendingLogo, setPendingLogo] = useState<string | null>(null);

	React.useEffect(() => {
		setPendingLogo(null);
	}, [selectedOrganization?.id]);

	if (!selectedOrganization) {
		return (
			<div className="space-y-2">
				<h3 className="text-lg font-medium">Organization Logo</h3>
				<p className="text-muted-foreground text-sm">
					Please select an organization to configure logo settings.
				</p>
			</div>
		);
	}

	const currentLogo = pendingLogo ?? selectedOrganization.logo;
	const hasPendingChange =
		pendingLogo !== null && pendingLogo !== selectedOrganization.logo;

	const handleFileChange = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.target.files?.[0];
		// Allow re-selecting the same file after a failed attempt.
		event.target.value = "";
		if (!file) {
			return;
		}
		if (!ACCEPTED_TYPES.includes(file.type)) {
			toast({
				title: "Unsupported image",
				description: "Please choose a PNG, JPEG or WebP image.",
				variant: "destructive",
			});
			return;
		}

		try {
			setPendingLogo(await fileToLogoDataUrl(file));
		} catch {
			toast({
				title: "Error",
				description: "Could not read this image. Please try another file.",
				variant: "destructive",
			});
		}
	};

	const saveLogo = async (logo: string | null) => {
		try {
			await updateOrganization.mutateAsync({
				params: { path: { id: selectedOrganization.id } },
				body: { logo },
			});
			setPendingLogo(null);
			toast({
				title: "Settings saved",
				description: logo
					? "Your organization logo has been updated."
					: "Your organization logo has been removed.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save organization logo settings.",
				variant: "destructive",
			});
		}
	};

	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-lg font-medium">Organization Logo</h3>
				<p className="text-muted-foreground text-sm">
					Shown next to your organization in the sidebar switcher
				</p>
			</div>

			<Separator />

			<div className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="orgLogo">Logo</Label>
					<div className="flex items-center gap-4">
						<OrganizationAvatar
							organization={{
								name: selectedOrganization.name,
								logo: currentLogo,
							}}
							className="h-16 w-16 rounded-lg text-base"
						/>
						<div className="flex flex-col gap-2">
							<Input
								id="orgLogo"
								ref={fileInputRef}
								type="file"
								accept={ACCEPTED_TYPES.join(",")}
								onChange={handleFileChange}
								className="hidden"
							/>
							<div className="flex gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => fileInputRef.current?.click()}
									disabled={updateOrganization.isPending}
								>
									{currentLogo ? "Change logo" : "Upload logo"}
								</Button>
								{selectedOrganization.logo && !hasPendingChange && (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => saveLogo(null)}
										disabled={updateOrganization.isPending}
									>
										Remove
									</Button>
								)}
							</div>
							<p className="text-sm text-muted-foreground">
								PNG, JPEG or WebP. Square images work best.
							</p>
						</div>
					</div>
				</div>
			</div>

			{hasPendingChange && (
				<div className="flex justify-end gap-2">
					<Button
						variant="ghost"
						onClick={() => setPendingLogo(null)}
						disabled={updateOrganization.isPending}
					>
						Cancel
					</Button>
					<Button
						onClick={() => saveLogo(pendingLogo)}
						disabled={updateOrganization.isPending}
					>
						{updateOrganization.isPending ? "Saving..." : "Save Logo"}
					</Button>
				</div>
			)}
		</div>
	);
}
