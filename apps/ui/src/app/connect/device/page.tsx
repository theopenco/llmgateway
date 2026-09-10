import { DeviceApproval } from "./device-approval";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Authorize LLM Gateway CLI",
	robots: { index: false, follow: false },
};

export default async function DevicePage({
	searchParams,
}: {
	searchParams: Promise<{ user_code?: string }>;
}) {
	const { user_code: userCode } = await searchParams;
	return (
		<div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
			<div className="w-full max-w-md">
				<DeviceApproval
					initialCode={typeof userCode === "string" ? userCode : ""}
				/>
			</div>
		</div>
	);
}
