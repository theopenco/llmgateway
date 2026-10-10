import { TurboModuleRegistry } from "react-native";

import type { TurboModule } from "react-native";

export interface Spec extends TurboModule {
	open: (url: string) => Promise<string>;
	cancel: () => void;
}

export default TurboModuleRegistry.getEnforcing<Spec>("NativeLoungeAuth");
