import contentCollections from "@content-collections/vinxi";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "@tanstack/react-start/config";
import svgr from "vite-plugin-svgr";
import tsConfigPaths from "vite-tsconfig-paths";

// noinspection JSUnusedGlobalSymbols
export default defineConfig({
	tsr: {
		appDirectory: "./src",
	},
	vite: {
		plugins: [
			contentCollections(),
			tsConfigPaths({
				projects: ["./tsconfig.json"],
			}),
			tailwindcss(),
			svgr(),
		],
	},
});
