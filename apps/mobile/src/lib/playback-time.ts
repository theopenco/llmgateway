export function playbackTime(seconds: number) {
	const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
	return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
