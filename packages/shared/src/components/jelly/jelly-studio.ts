import { EquirectangularReflectionMapping, PMREMGenerator } from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

import type { WebGLRenderer } from "three";

export async function loadJellyStudio(
	renderer: WebGLRenderer,
	disposed: () => boolean,
) {
	const source = await new HDRLoader().loadAsync(
		new URL("../../../assets/jelly/window.hdr", import.meta.url).href,
	);
	if (disposed()) {
		source.dispose();
		return;
	}
	source.mapping = EquirectangularReflectionMapping;
	const pmrem = new PMREMGenerator(renderer);
	const environment = pmrem.fromEquirectangular(source);
	source.dispose();
	pmrem.dispose();
	return {
		environment: environment.texture,
		dispose() {
			environment.dispose();
		},
	};
}
