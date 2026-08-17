"use client";

import { useUpdateUser, useUser } from "@/hooks/useUser";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

import { TimeZoneSetting } from "@llmgateway/shared";

/** User-level display timezone control, rendered on the project Preferences
 *  page. Persists via PATCH /user/me; storage stays UTC. */
export function DisplayTimezoneCard() {
	const { user } = useUser();
	const updateUser = useUpdateUser();

	return (
		<Card>
			<CardHeader>
				<CardTitle>Display timezone</CardTitle>
				<CardDescription>
					How dates and times are shown across this dashboard
				</CardDescription>
			</CardHeader>
			<CardContent>
				<TimeZoneSetting
					value={user?.timezone ?? "UTC"}
					onValueChange={(timeZone) =>
						updateUser.mutate({ body: { timezone: timeZone } })
					}
				/>
			</CardContent>
		</Card>
	);
}
