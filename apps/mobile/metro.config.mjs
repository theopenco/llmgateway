import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultConfig, mergeConfig } from "@react-native/metro-config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(projectRoot, "../..");
export default mergeConfig(getDefaultConfig(projectRoot), {
	watchFolders: [workspaceRoot],
	resolver: {
		resolveRequest(context, moduleName, platform) {
			const resolved = moduleName.startsWith("@/")
				? path.resolve(projectRoot, "src", moduleName.slice(2))
				: moduleName;
			return context.resolveRequest(context, resolved, platform);
		},
		nodeModulesPaths: [
			path.join(projectRoot, "node_modules"),
			path.join(workspaceRoot, "node_modules"),
		],
		extraNodeModules: {
			react: path.join(projectRoot, "node_modules/react"),
			"react-native": path.join(projectRoot, "node_modules/react-native"),
		},
	},
});
