export function blobBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () =>
			reject(new Error("Could not read the audio response."));
		reader.onload = () => {
			const value = reader.result;
			const base64 =
				typeof value === "string" ? value.split(",")[1] : undefined;
			if (!base64) {
				reject(new Error("The model returned no audio."));
				return;
			}
			resolve(base64);
		};
		reader.readAsDataURL(blob);
	});
}
