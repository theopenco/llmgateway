import { useState } from "react";
import { Text, View } from "react-native";

import { styles } from "@/components/ui";

import { renderMap } from "@llmgateway/shared/sandbox-escape";

import type { GameState } from "@llmgateway/shared/sandbox-escape";

const tiles: Record<
	string,
	{ symbol: string; color: string; background: string }
> = {
	"@": { symbol: "●", color: "#D2EF9A", background: "#254532" },
	"#": { symbol: "", color: "#728C7C", background: "#31483B" },
	".": { symbol: "", color: "#55705F", background: "#10231B" },
	K: { symbol: "◆", color: "#FFD479", background: "#10231B" },
	D: { symbol: "×", color: "#FF94A3", background: "#4B2330" },
	$: { symbol: "$", color: "#91D3FF", background: "#17384B" },
	E: { symbol: "↗", color: "#D2EF9A", background: "#28503A" },
};
export function EscapeBoard({ state }: { state: GameState }) {
	const [width, setWidth] = useState(0);
	const cell = Math.min(38, width / state.width);
	return (
		<View style={{ gap: 10 }}>
			<View
				onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
				style={{ width: "100%", alignItems: "center" }}
			>
				<View
					accessible
					accessibilityLabel={`Game board. Process at column ${state.player.x + 1}, row ${state.player.y + 1}. Exit at column ${state.exit.x + 1}, row ${state.exit.y + 1}. ${state.shards.length} keys remaining. ${state.daemons.length} daemons. ${state.frozenTurns ? `Daemons frozen for ${state.frozenTurns} turns.` : "Daemons active."}`}
				>
					{renderMap(state)
						.split("\n")
						.map((row, y) => (
							<View key={y} style={{ flexDirection: "row" }}>
								{Array.from({ length: state.width }, (_, x) => ({
									value: row.charAt(x),
									x,
								})).map(({ value, x }) => (
									<View
										key={x}
										style={{ width: cell, height: cell, padding: 1 }}
									>
										<View
											style={{
												flex: 1,
												borderRadius: 3,
												backgroundColor: tiles[value].background,
												alignItems: "center",
												justifyContent: "center",
											}}
										>
											<Text
												allowFontScaling={false}
												style={{
													color: tiles[value].color,
													fontFamily: "Menlo",
													fontWeight: "700",
													fontSize: cell * 0.66,
												}}
											>
												{tiles[value].symbol}
											</Text>
										</View>
									</View>
								))}
							</View>
						))}
				</View>
			</View>
			<Text style={styles.muted}>
				● Process · ◆ Key · × Daemon · $ Freeze · ↗ Exit
			</Text>
		</View>
	);
}
export function EscapeHud({ state }: { state: GameState }) {
	return (
		<View style={{ gap: 4 }}>
			<Text style={styles.body}>
				Step {state.step} / {state.stepBudget} · Par {state.par}
			</Text>
			<Text style={styles.body}>
				Keys {state.collected} / {state.totalShards} · Gate{" "}
				{state.collected === state.totalShards ? "open" : "sealed"}
			</Text>
			<Text style={styles.muted}>
				{state.frozenTurns
					? `Daemons frozen: ${state.frozenTurns} turns`
					: "Daemons active"}
			</Text>
			<Text accessibilityLiveRegion="polite" style={styles.body}>
				{state.lastEvent}
			</Text>
		</View>
	);
}
