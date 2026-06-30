"use client";

import { useState } from "react";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";

import DevPassBillingDetails from "./DevPassBillingDetails";

export default function BillingDetailsDialog({
	children,
}: {
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Billing details</DialogTitle>
					<DialogDescription>
						Add the company and address details you want on your DevPass
						invoices. You can change these any time.
					</DialogDescription>
				</DialogHeader>
				<DevPassBillingDetails embedded onSaved={() => setOpen(false)} />
			</DialogContent>
		</Dialog>
	);
}
