"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { spotlightStore } from "@/components/assistant/assistant-store";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useWebMcpTools } from "@/hooks/useWebMcpTools";
import { getApiErrorMessage } from "@/lib/api-error";
import { describePage, findControl } from "@/lib/assistant-dom";
import { getAssistantPages } from "@/lib/assistant-pages";
import { useFetchClient } from "@/lib/fetch-client";
import {
	buildDashboardUrl,
	extractOrgAndProjectFromPath,
} from "@/lib/navigation-utils";
import { getModelContext, type WebMcpToolDefinition } from "@/lib/webmcp";

const NAVIGATION_TIMEOUT_MS = 8000;
const SETTLE_MS = 500;

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPath(path: string, signal: AbortSignal) {
	const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
	while (window.location.pathname !== path) {
		if (signal.aborted || Date.now() > deadline) {
			return false;
		}
		await delay(100);
	}
	// Let the page mount and register its own tools.
	await delay(SETTLE_MS);
	return true;
}

/** Tools every dashboard page offers: navigation, pointing and reading. */
export function useDashboardTools() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const fetchClient = useFetchClient();
	const pathname = usePathname();
	const { buildOrgUrl, selectedOrganization, currentProject, projects } =
		useDashboardNavigation();

	// Organization pages carry no project in the URL, and the dashboard's
	// selected project can lag there. Stay on the last project the user was
	// actually in, so navigation, writes and billing do not jump mid-task.
	const routeProjectId = extractOrgAndProjectFromPath(pathname).projectId;
	const [pinnedProjectId, setPinnedProjectId] = useState(routeProjectId);
	if (routeProjectId && routeProjectId !== pinnedProjectId) {
		setPinnedProjectId(routeProjectId);
	}
	const project =
		projects.find((candidate) => candidate.id === pinnedProjectId) ??
		currentProject ??
		projects[0] ??
		null;

	const pages = useMemo(
		() => getAssistantPages(selectedOrganization?.role),
		[selectedOrganization?.role],
	);

	const tools: WebMcpToolDefinition[] = [
		{
			name: "open_page",
			title: "Open a dashboard page",
			description: `Navigate the dashboard to a page. More tools can appear once the page opens; the result lists them. Pages: ${pages
				.map((page) => `${page.id} (${page.section} › ${page.label})`)
				.join(", ")}.`,
			inputSchema: {
				type: "object",
				properties: {
					page: { type: "string", enum: pages.map((page) => page.id) },
				},
				required: ["page"],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: true },
			execute: async (input, { signal }) => {
				const page = pages.find((candidate) => candidate.id === input.page);
				if (!page) {
					return {
						error: "Unknown page",
						pages: pages.map((candidate) => candidate.id),
					};
				}
				const href =
					page.scope === "organization"
						? buildOrgUrl(page.href)
						: buildDashboardUrl(
								selectedOrganization?.id,
								project?.id,
								page.href || undefined,
							);
				spotlightStore.set(null);
				router.push(href);
				if (!(await waitForPath(href, signal))) {
					return { error: `${page.label} did not open` };
				}
				return {
					opened: `${page.section} › ${page.label}`,
					tools: (await getModelContext().getTools()).map((tool) => tool.name),
				};
			},
		},
		{
			name: "read_page",
			title: "Read the current page",
			description:
				"List the headings and controls visible on the current page, to learn what the user can do here before pointing at something.",
			inputSchema: { type: "object", properties: {} },
			annotations: { readOnlyHint: true, untrustedContentHint: true },
			execute: async () => describePage(),
		},
		{
			name: "point_at",
			title: "Point at a control",
			description:
				"Scroll to a visible button, link, field, tab or heading on the current page and spotlight it for the user. Pass the visible label, e.g. 'Create API Key'. Open the right page first.",
			inputSchema: {
				type: "object",
				properties: {
					label: {
						type: "string",
						description: "Visible text of the control",
					},
				},
				required: ["label"],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: true },
			execute: async (input) => {
				const label = typeof input.label === "string" ? input.label : "";
				const control = findControl(label);
				if (!control) {
					return {
						found: false,
						visibleControls: describePage(40).controls,
					};
				}
				control.element.scrollIntoView({ block: "center", behavior: "smooth" });
				spotlightStore.set({ element: control.element, label: control.label });
				return { found: true, pointingAt: control.label, kind: control.kind };
			},
		},
		{
			name: "get_credit_balance",
			title: "Read the credit balance",
			description:
				"Return the organization's current credit balance in USD and its plan.",
			inputSchema: { type: "object", properties: {} },
			annotations: { readOnlyHint: true },
			execute: async () => ({
				organization: selectedOrganization?.name,
				creditsUsd: selectedOrganization?.credits,
				plan: selectedOrganization?.plan,
			}),
		},
		{
			name: "create_project",
			title: "Create a project",
			description: `Create a new project in the organization "${selectedOrganization?.name ?? ""}". Changes data: the user approves it in a dialog.`,
			inputSchema: {
				type: "object",
				properties: {
					name: { type: "string", minLength: 1, maxLength: 255 },
				},
				required: ["name"],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: false, consequentialHint: true },
			execute: async (input) => {
				const name = typeof input.name === "string" ? input.name.trim() : "";
				if (!name || !selectedOrganization) {
					return { error: "A project name is required" };
				}
				const { data, error } = await fetchClient.POST("/projects", {
					body: { name, organizationId: selectedOrganization.id },
				});
				if (error) {
					throw new Error(
						getApiErrorMessage(error, "Failed to create the project."),
					);
				}
				await queryClient.invalidateQueries({
					queryKey: ["get", "/orgs/{id}/projects"],
				});
				router.refresh();
				return { created: true, name: data.project.name };
			},
		},
	];

	useWebMcpTools(
		selectedOrganization?.role === "developer"
			? tools.filter((tool) => tool.name !== "create_project")
			: tools,
	);

	return { organization: selectedOrganization, project };
}
