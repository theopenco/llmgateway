import { Rocket } from "lucide-react";
import * as React from "react";

import { useAuth } from "@/lib/auth-client";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Step } from "@/lib/components/stepper";

export function WelcomeStep() {
	const { useSession } = useAuth();
	const session = useSession();
	const user = session.data?.user;
	const organization = { name: "Your Organization" };

	return (
		<Step>
			<div className="flex flex-col gap-6">
				<div className="flex flex-col gap-2 text-center">
					<h1 className="text-2xl font-bold">Welcome to LLM Gateway!</h1>
					<p className="text-muted-foreground">
						Let's get you set up with everything you need to start using the
						platform.
					</p>
				</div>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Rocket className="h-5 w-5" />
							Your Project is Ready
						</CardTitle>
						<CardDescription>
							We've automatically created a project for you to get started.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						<div className="grid grid-cols-2 gap-4">
							<div>
								<p className="text-sm font-medium">User</p>
								<p className="text-muted-foreground text-sm">{user?.name}</p>
							</div>
							<div>
								<p className="text-sm font-medium">Email</p>
								<p className="text-muted-foreground text-sm">{user?.email}</p>
							</div>
							<div>
								<p className="text-sm font-medium">Organization</p>
								<p className="text-muted-foreground text-sm">
									{organization?.name}
								</p>
							</div>
							<div>
								<p className="text-sm font-medium">Project</p>
								<p className="text-muted-foreground text-sm">Default Project</p>
							</div>
						</div>

						<div className="rounded-md bg-muted p-4">
							<p className="text-sm">
								In this onboarding process, we'll help you:
							</p>
							<ul className="mt-2 list-inside list-disc text-sm">
								<li>Create your first API key to access the LLM Gateway</li>
								<li>
									Choose between buying credits or bringing your own API keys
								</li>
								<li>Set up your preferred payment method or provider keys</li>
								<li>Get you ready to start making requests</li>
							</ul>
						</div>
					</CardContent>
				</Card>
			</div>
		</Step>
	);
}
