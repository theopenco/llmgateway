import { useMutation, useQuery } from "@tanstack/react-query";
import * as Keychain from "react-native-keychain";

import { queryClient } from "@/api/client";

export function createModelPreference(name: string, fallback: string) {
	const service = `io.llmgateway.lounge.${name}-model`;
	const queryKey = [`${name}-model`];
	let version = 0;
	let writes: Promise<unknown> = Promise.resolve();
	function serialize<T>(operation: () => Promise<T>) {
		const result = writes.then(operation, operation);
		writes = result;
		return result;
	}
	async function clear() {
		version++;
		await serialize(() => Keychain.resetGenericPassword({ service }));
	}
	async function load() {
		const saved = await Keychain.getGenericPassword({ service });
		return saved ? saved.password : fallback;
	}
	async function save(value: string) {
		const expected = version;
		return await serialize(async () => {
			if (expected !== version) {
				throw new Error("Your session changed. Choose a model again.");
			}
			const result = await Keychain.setGenericPassword("model", value, {
				service,
				accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
			});
			if (!result) {
				throw new Error(`The ${name} model could not be saved.`);
			}
			if (expected === version) {
				queryClient.setQueryData(queryKey, value);
			}
		});
	}
	function useModel() {
		const model = useQuery({
			queryKey,
			queryFn: load,
			staleTime: Infinity,
		});
		const mutation = useMutation({ mutationFn: save });
		return { ...model, save: mutation };
	}

	return { clear, load, save, useModel };
}
