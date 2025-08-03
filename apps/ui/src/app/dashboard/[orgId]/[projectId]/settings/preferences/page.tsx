import { CachingSettings } from "@/components/settings/caching-settings";
import { ProjectModeSettings } from "@/components/settings/project-mode-settings";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

export default function PreferencesPage() {
	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-3xl font-bold tracking-tight">Preferences</h2>
				</div>
				<div className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>Project Mode</CardTitle>
							<CardDescription>
								Configure how your organization handles projects
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ProjectModeSettings />
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Caching</CardTitle>
							<CardDescription>
								Configure caching settings for your API requests
							</CardDescription>
						</CardHeader>
						<CardContent>
							<CachingSettings />
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
