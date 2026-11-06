import { redirect } from "next/navigation";

import { ProviderDpaTable } from "@/components/provider-dpa-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";

export default async function ProviderDpasPage() {
	await requireSession();

	const $api = await createServerApiClient();
	const { data, error } = await $api.GET("/admin/provider-dpas");

	if (error || !data) {
		redirect("/login");
	}

	const signedCount = data.providers.filter(
		(provider) => provider.dpaSignedAt !== null,
	).length;

	return (
		<div className="space-y-6 p-6">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">Provider DPAs</h1>
				<p className="text-muted-foreground mt-1 text-sm">
					Record which AI providers have a signed data-processing agreement on
					file ({signedCount}/{data.providers.length} confirmed). Mark a
					provider signed only once the agreement is evidenced per{" "}
					<code>legal/SUBPROCESSOR_DPAS.md</code> — a filed artifact, not a
					vendor page that claims incorporation.
				</p>
			</div>

			{data.enforcementEnabled ? (
				<Alert>
					<AlertTitle>DPA enforcement is ON</AlertTitle>
					<AlertDescription>
						REQUIRE_PROVIDER_DPA_FOR_GDPR is enabled: organizations whose
						compliance policy requires GDPR-compliant providers can only route
						to providers marked signed here. Changing a row changes live routing
						for those organizations.
					</AlertDescription>
				</Alert>
			) : (
				<Alert>
					<AlertTitle>DPA enforcement is OFF</AlertTitle>
					<AlertDescription>
						REQUIRE_PROVIDER_DPA_FOR_GDPR is not set, so these records are
						informational and GDPR compliance routing only checks the
						catalogue&apos;s GDPR flag. Enable the flag in the infra environment
						once the records below are filled in.
					</AlertDescription>
				</Alert>
			)}

			<ProviderDpaTable providers={data.providers} />
		</div>
	);
}
