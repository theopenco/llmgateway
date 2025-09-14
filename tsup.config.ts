import { fixExtensionsPlugin } from "esbuild-fix-imports-plugin";
import { defineConfig } from "tsup";

export const tsup = defineConfig({
	splitting: true,
	clean: true,
	dts: true,
	format: ["esm"],
	bundle: true,
	minify: false,
	entry: ["src/**/!(*.spec|*.e2e).ts"],
	sourcemap: true,
	target: "esnext",
	esbuildPlugins: [
		fixExtensionsPlugin(), // https://github.com/egoist/tsup/issues/953#issuecomment-2434492992
	],
	banner: {
		// fix dynamic require for now
		js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
	},
});
