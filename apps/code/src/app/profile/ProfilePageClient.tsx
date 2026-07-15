"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	Check,
	Copy,
	ExternalLink,
	Globe,
	Image as ImageIcon,
	Lock,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { ProfileReadmeBadge } from "@/components/profile/ProfileReadmeBadge";
import {
	ProfileView,
	type ProfileData,
} from "@/components/profile/ProfileView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

type UserMe =
	paths["/user/me"]["get"]["responses"][200]["content"]["application/json"]["user"];

interface ProfilePageClientProps {
	initialProfile: ProfileData | null;
	initialUser: UserMe;
}

export function ProfilePageClient({
	initialProfile,
	initialUser,
}: ProfilePageClientProps) {
	const api = useApi();
	const queryClient = useQueryClient();

	const [username, setUsername] = useState(initialUser.username ?? "");
	const [savedUsername, setSavedUsername] = useState(
		initialUser.username ?? "",
	);
	const [profilePublic, setProfilePublic] = useState(initialUser.profilePublic);
	const [showPicture, setShowPicture] = useState(
		!initialUser.profileHidePicture,
	);
	const [name, setName] = useState(initialUser.name ?? "");
	const [bio, setBio] = useState(initialUser.bio ?? "");
	const [github, setGithub] = useState(initialUser.githubUsername ?? "");
	const [x, setX] = useState(initialUser.xUsername ?? "");
	const [copied, setCopied] = useState(false);

	const updateUser = api.useMutation("patch", "/user/me");

	const origin = typeof window !== "undefined" ? window.location.origin : "";
	const shareUrl = savedUsername ? `${origin}/profiles/${savedUsername}` : "";

	const invalidate = async () => {
		await queryClient.invalidateQueries({
			predicate: (query) => {
				const key = query.queryKey;
				return (
					Array.isArray(key) &&
					(key[1] === "/user/me" || key[1] === "/user/profile")
				);
			},
		});
	};

	const handleSave = async () => {
		const trimmedUsername = username.trim().toLowerCase();
		try {
			const result = await updateUser.mutateAsync({
				body: {
					name: name.trim() || undefined,
					username: trimmedUsername ? trimmedUsername : null,
					profilePublic,
					profileHidePicture: !showPicture,
					bio: bio.trim() ? bio.trim() : null,
					githubUsername: github.trim() ? github.trim() : null,
					xUsername: x.trim() ? x.trim() : null,
				},
			});
			setSavedUsername(result.user.username ?? "");
			setProfilePublic(result.user.profilePublic);
			setShowPicture(!result.user.profileHidePicture);
			await invalidate();
			toast.success("Profile saved");
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to save profile";
			toast.error(message);
		}
	};

	const handleCopy = async () => {
		if (!shareUrl) {
			return;
		}
		await navigator.clipboard.writeText(shareUrl);
		setCopied(true);
		toast.success("Link copied");
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<div className="mx-auto w-full max-w-5xl space-y-10">
			<div>
				<h1 className="text-lg font-semibold tracking-tight">Your profile</h1>
				<p className="mt-0.5 text-sm text-muted-foreground">
					Share your AI coding activity. Profiles are private by default.
				</p>
			</div>

			{/* Sharing controls */}
			<section className="rounded-2xl border bg-card">
				<div className="flex items-start justify-between gap-4 border-b p-5">
					<div className="flex items-start gap-3">
						<div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20">
							{profilePublic ? (
								<Globe className="h-4 w-4 text-emerald-500" />
							) : (
								<Lock className="h-4 w-4 text-muted-foreground" />
							)}
						</div>
						<div className="space-y-0.5">
							<Label htmlFor="profile-public" className="text-sm font-medium">
								Public profile
							</Label>
							<p className="text-xs text-muted-foreground">
								{profilePublic
									? "Anyone with your link can view this profile."
									: "Only you can see this profile."}
							</p>
						</div>
					</div>
					<Switch
						id="profile-public"
						checked={profilePublic}
						onCheckedChange={setProfilePublic}
					/>
				</div>

				<div className="flex items-start justify-between gap-4 border-b p-5">
					<div className="flex items-start gap-3">
						<div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20">
							<ImageIcon
								className={
									showPicture
										? "h-4 w-4 text-emerald-500"
										: "h-4 w-4 text-muted-foreground"
								}
							/>
						</div>
						<div className="space-y-0.5">
							<Label
								htmlFor="profile-show-picture"
								className="text-sm font-medium"
							>
								Show profile picture
							</Label>
							<p className="text-xs text-muted-foreground">
								{showPicture
									? "Your profile picture is shown on your public profile."
									: "Your initials are shown instead of your picture."}
							</p>
						</div>
					</div>
					<Switch
						id="profile-show-picture"
						checked={showPicture}
						onCheckedChange={setShowPicture}
					/>
				</div>

				<div className="space-y-5 p-5">
					<div className="space-y-1.5">
						<Label htmlFor="username">Username</Label>
						<div className="flex items-center rounded-md border bg-background focus-within:ring-1 focus-within:ring-ring">
							<span className="pl-3 text-sm text-muted-foreground">
								/profiles/
							</span>
							<Input
								id="username"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								placeholder="your-handle"
								className="border-0 pl-1 shadow-none focus-visible:ring-0"
							/>
						</div>
						<p className="text-xs text-muted-foreground">
							3–30 characters, lowercase letters, numbers, hyphens or
							underscores.
						</p>
					</div>

					<div className="grid gap-5 sm:grid-cols-2">
						<div className="space-y-1.5">
							<Label htmlFor="name">Display name</Label>
							<Input
								id="name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Your name"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="github">GitHub username</Label>
							<Input
								id="github"
								value={github}
								onChange={(e) => setGithub(e.target.value)}
								placeholder="octocat"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="x">X username</Label>
							<Input
								id="x"
								value={x}
								onChange={(e) => setX(e.target.value)}
								placeholder="handle"
							/>
						</div>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="bio">Bio</Label>
						<Textarea
							id="bio"
							value={bio}
							onChange={(e) => setBio(e.target.value)}
							placeholder="A short line about what you build."
							maxLength={280}
							rows={2}
						/>
					</div>

					<div className="flex flex-wrap items-center justify-between gap-3">
						<Button onClick={handleSave} disabled={updateUser.isPending}>
							{updateUser.isPending ? "Saving…" : "Save profile"}
						</Button>

						{profilePublic && shareUrl && (
							<div className="flex items-center gap-2">
								<code className="rounded-md border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
									{shareUrl}
								</code>
								<Button
									variant="outline"
									size="sm"
									onClick={handleCopy}
									className="gap-1.5"
								>
									{copied ? (
										<Check className="h-3.5 w-3.5" />
									) : (
										<Copy className="h-3.5 w-3.5" />
									)}
									Copy
								</Button>
								<Button variant="ghost" size="sm" asChild className="gap-1.5">
									<Link
										href={`/profiles/${savedUsername}`}
										target="_blank"
										rel="noopener noreferrer"
									>
										<ExternalLink className="h-3.5 w-3.5" />
										View
									</Link>
								</Button>
							</div>
						)}
					</div>

					{profilePublic && savedUsername && (
						<div className="space-y-2 border-t pt-5">
							<Label>README badge</Label>
							<ProfileReadmeBadge username={savedUsername} baseUrl={origin} />
						</div>
					)}
				</div>
			</section>

			{/* Live preview */}
			{initialProfile && (
				<div>
					<h2 className="mb-4 text-sm font-semibold text-muted-foreground">
						Preview
					</h2>
					<div className="rounded-2xl border bg-background/40 p-5 sm:p-8">
						<ProfileView profile={initialProfile} />
					</div>
				</div>
			)}
		</div>
	);
}
