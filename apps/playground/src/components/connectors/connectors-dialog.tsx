"use client";

import { Plug } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";

import { GithubConnector } from "./github-connector";

export function ConnectorsDialog({ trigger }: { trigger?: React.ReactNode }) {
	const [open, setOpen] = useState(false);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				{trigger ?? (
					<Button variant="ghost">
						<Plug className="mr-2 size-4" />
						Connectors
					</Button>
				)}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Connectors</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-6">
					<GithubConnector />
					{/* Future: add more connectors here */}
				</div>
			</DialogContent>
		</Dialog>
	);
}
