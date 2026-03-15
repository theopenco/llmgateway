import { toast } from "@/lib/components/use-toast";

// This function needs to be converted to a hook or used within a component
// since we can't use hooks in a standalone function
export function createAddPasskeyFunction(authClient: any) {
	return async function addPasskey() {
		try {
			const result = await authClient.passkey.addPasskey({
				authenticatorAttachment: "cross-platform",
			});

			if (result?.error) {
				toast({
					title: "Error adding passkey",
					description: result.error.message ?? "Please try again",
				});
				return;
			}

			toast({
				title: "Passkey added",
				description: "You can now sign in using your passkey",
			});
		} catch {
			toast({
				title: "Error adding passkey",
				description: "An unexpected error occurred",
				variant: "destructive",
			});
		}
	};
}
