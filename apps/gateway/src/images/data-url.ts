const DATA_URL_HEADER = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;

function isBase64PayloadChar(code: number): boolean {
	return (
		(code >= 65 && code <= 90) || // A-Z
		(code >= 97 && code <= 122) || // a-z
		(code >= 48 && code <= 57) || // 0-9
		code === 43 || // +
		code === 47 || // /
		code === 61 || // =
		code === 32 ||
		(code >= 9 && code <= 13) // \t \n \v \f \r
	);
}

/**
 * Validates a base64 image data URL with a linear scan. A regex over the
 * multi-megabyte payload overflows V8's backtracking stack (RangeError).
 */
export function isValidBase64ImageDataUrl(value: string): boolean {
	const header = DATA_URL_HEADER.exec(value.slice(0, 128));
	if (!header) {
		return false;
	}
	const start = header[0].length;
	if (start === value.length) {
		return false;
	}
	for (let i = start; i < value.length; i++) {
		if (!isBase64PayloadChar(value.charCodeAt(i))) {
			return false;
		}
	}
	return true;
}
