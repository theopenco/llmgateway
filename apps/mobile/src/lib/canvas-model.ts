import { useMutation, useQuery } from "@tanstack/react-query";
import * as Keychain from "react-native-keychain";

import { queryClient } from "@/api/client";

const service = "io.llmgateway.lounge.canvas-model";
const queryKey = ["canvas-model"];
let version = 0;
let writes: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>) {
	const result = writes.then(operation, operation);
	writes = result;
	return result;
}
export async function clearCanvasModel() {
	version++;
	await serialize(() => Keychain.resetGenericPassword({ service }));
}
export async function loadCanvasModel() {
	const saved = await Keychain.getGenericPassword({ service });
	return saved ? saved.password : "auto";
}
export async function saveCanvasModel(value: string) {
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
			throw new Error("The canvas model could not be saved.");
		}
		if (expected === version) {
			queryClient.setQueryData(queryKey, value);
		}
	});
}
export function useCanvasModel() {
	const model = useQuery({
		queryKey,
		queryFn: loadCanvasModel,
		staleTime: Infinity,
	});
	const save = useMutation({
		mutationFn: saveCanvasModel,
	});
	return { ...model, save };
}
