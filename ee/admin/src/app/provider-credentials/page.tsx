import Link from "next/link";

import { ProviderCredentialsManager } from "@/components/provider-credentials-manager";
import { Button } from "@/components/ui/button";
import {
	createProviderCredential,
	deleteProviderCredential,
	getProviderCredentialCatalog,
	getProviderCredentials,
	reorderProviderCredentials,
	selfTestProviderCredential,
	updateProviderCredential,
	verifyProviderCredentialModels,
} from "@/lib/admin-provider-credentials";

function SignInPrompt() {
	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-md text-center">
				<div className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight">
						Admin Dashboard
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Sign in to access the admin dashboard
					</p>
				</div>
				<Button asChild size="lg" className="w-full">
					<Link href="/login">Sign In</Link>
				</Button>
			</div>
		</div>
	);
}

export default async function ProviderCredentialsPage() {
	const [credentialsData, catalogData] = await Promise.all([
		getProviderCredentials(),
		getProviderCredentialCatalog(),
	]);

	if (!credentialsData || !catalogData) {
		return <SignInPrompt />;
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 overflow-hidden px-4 py-8 md:px-8">
			<header>
				<h1 className="text-3xl font-semibold tracking-tight">
					Provider Credentials
				</h1>
				<p className="mt-1 max-w-3xl text-sm text-muted-foreground">
					The credentials LLM Gateway pays for, used to serve credits-mode
					traffic. A provider with managed credentials here ignores its{" "}
					<code>LLM_*</code> environment variables entirely; providers without
					one keep reading the environment, so migrating can be done a provider
					at a time.
				</p>
			</header>

			<ProviderCredentialsManager
				credentials={credentialsData.credentials}
				catalog={catalogData.providers}
				envSource={catalogData.envSource}
				envPublishedAt={catalogData.envPublishedAt}
				onCreate={createProviderCredential}
				onUpdate={updateProviderCredential}
				onDelete={deleteProviderCredential}
				onReorder={reorderProviderCredentials}
				onSelfTest={selfTestProviderCredential}
				onVerifyModels={verifyProviderCredentialModels}
			/>
		</div>
	);
}
