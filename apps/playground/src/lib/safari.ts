export function isSafari(): boolean {
	if (typeof navigator === "undefined") {
		return false;
	}
	const ua = navigator.userAgent;
	return (
		ua.includes("Safari") && !ua.includes("Chrome") && !ua.includes("Chromium")
	);
}
