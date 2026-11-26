"use client";

import { Printer } from "lucide-react";

import { Button } from "@/lib/components/button";

export function PrintReportButton() {
	return (
		<Button
			type="button"
			variant="outline"
			className="print:hidden"
			onClick={() => window.print()}
		>
			<Printer className="size-4" aria-hidden="true" />
			Save as PDF
		</Button>
	);
}
