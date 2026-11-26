import { Image, Text, View } from "react-native";
import { WebView } from "react-native-webview";

import { colors, styles } from "@/components/ui";

import type { GeneratedImage } from "@/api/images";

export function isSvg(image: GeneratedImage) {
	return image.mediaType === "image/svg+xml";
}

export function GeneratedImageView({
	image,
	label,
}: {
	image: GeneratedImage;
	label: string;
}) {
	if (!isSvg(image)) {
		return (
			<Image
				accessibilityLabel={label}
				source={{ uri: `data:${image.mediaType};base64,${image.base64}` }}
				style={{ width: "100%", aspectRatio: 1, borderRadius: 18 }}
				resizeMode="contain"
			/>
		);
	}
	const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>html,body{margin:0;height:100%;background:transparent}img{width:100%;height:100%;object-fit:contain}</style></head><body><img alt="" src="data:image/svg+xml;base64,${image.base64}"></body></html>`;
	return (
		<View
			accessible
			accessibilityRole="image"
			accessibilityLabel={`${label}, SVG`}
			style={{ gap: 6 }}
		>
			<View
				style={{
					width: "100%",
					aspectRatio: 1,
					borderRadius: 18,
					overflow: "hidden",
				}}
			>
				<WebView
					source={{ html }}
					originWhitelist={["about:*"]}
					javaScriptEnabled={false}
					scrollEnabled={false}
					onShouldStartLoadWithRequest={(request) =>
						request.url.startsWith("about:")
					}
					style={{ backgroundColor: "transparent" }}
				/>
			</View>
			<Text style={[styles.muted, { color: colors.accent, fontWeight: "600" }]}>
				SVG
			</Text>
		</View>
	);
}
