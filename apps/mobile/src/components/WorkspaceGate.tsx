import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { clearSession } from "@/auth/session";
import { Button, ErrorNotice, Loading, Screen } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace";
import { Workspaces } from "@/screens/Workspaces";

import type { Workspace } from "@/lib/workspace";
import type { ReactNode } from "react";

export function WorkspaceGate({
	children,
	onSignedOut,
}: {
	children: (workspace: Workspace) => ReactNode;
	onSignedOut: () => void;
}) {
	const workspace = useWorkspace();
	const [choosing, setChoosing] = useState(false);
	const reset = useMutation({
		mutationFn: clearSession,
		onSuccess: onSignedOut,
	});
	if (workspace.data && !workspace.isError) {
		return children(workspace.data);
	}
	if (choosing) {
		return (
			<Workspaces
				fullScreen
				onSelect={() => setChoosing(false)}
				onCancel={() => setChoosing(false)}
			/>
		);
	}
	if (workspace.isPending) {
		return (
			<Screen fullScreen>
				<Loading />
			</Screen>
		);
	}
	return (
		<Screen fullScreen>
			<ErrorNotice error={workspace.error} />
			<Button
				title="Try again"
				busy={workspace.isFetching}
				onPress={() => void workspace.refetch()}
			/>
			<Button
				title="Choose workspace"
				secondary
				disabled={workspace.isFetching}
				onPress={() => setChoosing(true)}
			/>
			<ErrorNotice error={reset.error} />
			<Button
				title="Sign in again"
				secondary
				onPress={() => reset.mutate()}
				busy={reset.isPending}
			/>
		</Screen>
	);
}
