interface LoadedFont {
	style: { fontFamily: string };
}

export function fontStack(family: string, font: LoadedFont): string {
	const [, ...fallbacks] = font.style.fontFamily.split(/,\s*/);
	return [`'${family}'`, ...fallbacks].join(", ");
}
