"use client";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

import { TimeZoneSetting } from "@llmgateway/shared";

/** Client wrapper so the server-rendered page doesn't pull the shared
 *  component barrel into its own module graph. */
export function TimeDisplayCard() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Time display</CardTitle>
				<CardDescription>
					Choose whether dates and times are shown in your local timezone or in
					UTC
				</CardDescription>
			</CardHeader>
			<CardContent>
				<TimeZoneSetting />
			</CardContent>
		</Card>
	);
}
