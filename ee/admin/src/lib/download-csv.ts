export function downloadBlob(filename: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, csv: string): void {
	downloadBlob(filename, new Blob([csv], { type: "text/csv;charset=utf-8" }));
}
