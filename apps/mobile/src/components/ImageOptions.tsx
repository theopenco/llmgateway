import { Text, View } from "react-native";

import { defaultImageSettings } from "@/api/images";
import { Choice } from "@/components/Choice";
import { ModelPicker } from "@/components/ModelPicker";
import { styles } from "@/components/ui";

import { getModelImageConfig } from "@llmgateway/shared/image-generation-config";

import type { ImageSettings } from "@/api/images";

const qualities = ["auto", "low", "medium", "high", "xhigh", "max"] as const;
const ratios = [
	"auto",
	"1:1",
	"16:9",
	"9:16",
	"3:4",
	"4:3",
	"3:2",
	"2:3",
	"5:4",
	"4:5",
	"21:9",
	"1:4",
	"4:1",
	"1:8",
	"8:1",
] as const;

export function ImageOptions({
	value,
	onChange,
}: {
	value: ImageSettings;
	onChange: (value: ImageSettings) => void;
}) {
	const config = getModelImageConfig(value.model);
	return (
		<View style={styles.card}>
			<ModelPicker
				value={value.model}
				onChange={(model) => onChange(defaultImageSettings(model))}
				output="image"
			/>
			{value.model !== "auto" && (
				<Choice
					label="Size"
					value={value.size}
					options={config.availableSizes}
					onChange={(size) => onChange({ ...value, size })}
				/>
			)}
			{!config.usesPixelDimensions && (
				<Choice
					label="Aspect ratio"
					value={value.aspectRatio}
					options={config.supportedAspectRatios ?? ratios}
					onChange={(aspectRatio) => onChange({ ...value, aspectRatio })}
				/>
			)}
			{config.supportsQuality && (
				<Choice
					label="Quality"
					value={value.quality}
					options={qualities.filter((quality) =>
						config.availableQualities.includes(quality),
					)}
					onChange={(quality) => onChange({ ...value, quality })}
				/>
			)}
			{config.supportsModeration && (
				<Choice
					label="Moderation"
					value={value.moderation}
					options={["auto", "low"]}
					onChange={(moderation) => onChange({ ...value, moderation })}
				/>
			)}
			<Text style={styles.muted}>
				Up to {config.maxInputImages} reference images.
			</Text>
		</View>
	);
}
