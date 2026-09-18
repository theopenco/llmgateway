import { render, screen, userEvent } from "@testing-library/react-native";

import { ProviderOptions } from "@/components/ProviderOptions";

import type { CatalogModel } from "@/components/ProviderOptions";

jest.mock("@/api/client", () => ({
	api: {
		useQuery: () => ({
			data: { providers: [{ id: "openai", name: "OpenAI" }] },
		}),
	},
}));
jest.useFakeTimers();

test("uses the catalogue ID and region, excluding inactive mappings", async () => {
	const mapping = {
		providerId: "openai",
		externalId: "upstream-deployment-name",
		region: null,
		status: "active",
	};
	const model = {
		id: "gpt-4o-mini",
		name: "GPT-4o Mini",
		mappings: [
			mapping,
			mapping,
			{ ...mapping, region: "us" },
			{ ...mapping, region: "inactive", status: "inactive" },
			{ ...mapping, region: "retired", deactivatedAt: "2020-01-01" },
		],
	} as CatalogModel;
	const choose = jest.fn();
	await render(
		<ProviderOptions model={model} onChoose={choose} onBack={jest.fn()} />,
	);
	expect(screen.getAllByRole("button", { name: "Use OpenAI" })).toHaveLength(1);
	expect(screen.queryByText(/inactive|retired/)).not.toBeOnTheScreen();
	const user = userEvent.setup();
	await user.press(screen.getByRole("button", { name: "Use OpenAI · us" }));
	expect(choose).toHaveBeenCalledWith("openai/gpt-4o-mini:us");
});
