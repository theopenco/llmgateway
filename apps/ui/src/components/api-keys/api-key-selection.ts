export interface ApiKeySelectionSummary {
	/** Selected keys that are still part of the current view. */
	selectedIds: string[];
	allPageSelected: boolean;
	somePageSelected: boolean;
	allViewSelected: boolean;
	/** The view spans more keys than the current page shows. */
	viewExceedsPage: boolean;
}

export function summarizeApiKeySelection(
	selected: ReadonlySet<string>,
	pageIds: readonly string[],
	viewIds: readonly string[],
): ApiKeySelectionSummary {
	const selectedIds = viewIds.filter((id) => selected.has(id));
	const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;
	return {
		selectedIds,
		allPageSelected: pageIds.length > 0 && selectedOnPage === pageIds.length,
		somePageSelected: selectedOnPage > 0,
		allViewSelected:
			viewIds.length > 0 && selectedIds.length === viewIds.length,
		viewExceedsPage: viewIds.length > pageIds.length,
	};
}

/** Header checkbox: select every key on the page, or clear the page. */
export function togglePageSelection(
	selected: ReadonlySet<string>,
	pageIds: readonly string[],
): Set<string> {
	const next = new Set(selected);
	const allSelected =
		pageIds.length > 0 && pageIds.every((id) => selected.has(id));
	for (const id of pageIds) {
		if (allSelected) {
			next.delete(id);
		} else {
			next.add(id);
		}
	}
	return next;
}

export function toggleKeySelection(
	selected: ReadonlySet<string>,
	id: string,
): Set<string> {
	const next = new Set(selected);
	if (next.has(id)) {
		next.delete(id);
	} else {
		next.add(id);
	}
	return next;
}
