"use client";

import { CircleCheck, TriangleAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Card, CardContent } from "@/lib/components/card";

function VerificationResult() {
	const searchParams = useSearchParams();
	const success = searchParams.get("resultCode") === "10000";

	return (
		<Card className="w-full max-w-md">
			<CardContent className="flex flex-col items-center gap-3 p-8 text-center">
				{success ? (
					<>
						<CircleCheck className="h-10 w-10 text-green-600" />
						<p className="font-medium">Verification complete.</p>
						<p className="text-sm text-muted-foreground">
							You can close this window. Your LLM Gateway admin will finish
							adding your portrait.
						</p>
					</>
				) : (
					<>
						<TriangleAlert className="h-10 w-10 text-destructive" />
						<p className="font-medium">Verification did not complete.</p>
						<p className="text-sm text-muted-foreground">
							Ask for a new verification link and try again.
						</p>
					</>
				)}
			</CardContent>
		</Card>
	);
}

export default function PortraitVerificationPage() {
	return (
		<main className="flex min-h-screen items-center justify-center p-4">
			<Suspense>
				<VerificationResult />
			</Suspense>
		</main>
	);
}
