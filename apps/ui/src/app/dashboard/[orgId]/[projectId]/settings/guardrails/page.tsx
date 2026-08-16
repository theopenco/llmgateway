import { GuardrailsSettings } from "@/components/guardrails/guardrails-settings";

export default async function ProjectGuardrailsPage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
}) {
	const { orgId, projectId } = await params;

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
						Guardrails
					</h2>
				</div>
				<GuardrailsSettings
					scope={{ kind: "project", organizationId: orgId, projectId }}
				/>
			</div>
		</div>
	);
}
