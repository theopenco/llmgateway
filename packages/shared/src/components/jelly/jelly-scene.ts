/* eslint-disable no-mixed-operators -- Geometry and spring equations use standard arithmetic precedence. */

import {
	ACESFilmicToneMapping,
	Color,
	DirectionalLight,
	Mesh,
	MeshBasicMaterial,
	MeshPhysicalMaterial,
	PerspectiveCamera,
	Plane,
	PlaneGeometry,
	VSMShadowMap,
	Quaternion,
	Raycaster,
	Scene,
	ShaderChunk,
	Vector2,
	Vector3,
	WebGLRenderer,
} from "three";

import { createJellyGeometry } from "./jelly-geometry";
import { JellyPhysics } from "./jelly-physics";
import { defaultJellySettings, jellyFlavors } from "./jelly-settings";
import { loadJellyStudio } from "./jelly-studio";

import type { JellySettings } from "./jelly-settings";

export function createJellyScene(canvas: HTMLCanvasElement) {
	const renderer = new WebGLRenderer({
		canvas,
		alpha: true,
		antialias: true,
		powerPreference: "low-power",
	});
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
	renderer.setClearColor(0x000000, 0);
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.12;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = VSMShadowMap;
	const scene = new Scene();
	const camera = new PerspectiveCamera(34, 1, 0.1, 40);
	camera.position.set(0, 4.5, 9.2);
	camera.zoom = 1.25;
	camera.lookAt(0, 0, 0);
	const keyLight = new DirectionalLight(0xffffff, 0.001);
	keyLight.position.set(-5, 8, 5);
	keyLight.castShadow = true;
	keyLight.shadow.mapSize.set(256, 256);
	keyLight.shadow.camera.left = keyLight.shadow.camera.bottom = -5;
	keyLight.shadow.camera.right = keyLight.shadow.camera.top = 5;
	keyLight.shadow.normalBias = 0.025;
	keyLight.shadow.radius = 5;
	keyLight.shadow.blurSamples = 8;
	scene.add(keyLight);
	scene.environmentIntensity = 0.9;
	const geometry = createJellyGeometry();
	const physics = new JellyPhysics(geometry);
	const floorHeight = geometry.boundingBox!.min.y - 0.012;
	const material = new MeshPhysicalMaterial({
		color: 0xffe0eb,
		metalness: 0,
		roughness: 0.075,
		transmission: 1,
		thickness: 1.8,
		ior: 1.35,
		dispersion: 0.025,
		clearcoat: 0.42,
		clearcoatRoughness: 0.05,
		attenuationColor: new Color().setRGB(
			Math.exp(-5 * 0.035),
			Math.exp(-46 * 0.035),
			Math.exp(-23 * 0.035),
		),
		attenuationDistance: 0.6,
		envMapIntensity: 1.05,
	});
	material.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader.replace(
			"#include <common>",
			"#include <common>\nattribute float jellyThickness;\nvarying float vJellyThickness;",
		);
		shader.vertexShader = shader.vertexShader.replace(
			"#include <begin_vertex>",
			"#include <begin_vertex>\nvJellyThickness = jellyThickness;",
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <common>",
			"#include <common>\nvarying float vJellyThickness;",
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <transmission_fragment>",
			ShaderChunk.transmission_fragment.replace(
				"material.thickness = thickness;",
				"material.thickness = vJellyThickness;",
			),
		);
	};
	const jelly = new Mesh(geometry, material);
	jelly.rotation.set(0, -0.18, 0);
	jelly.frustumCulled = false;
	jelly.castShadow = true;
	scene.add(jelly);
	const wireMaterial = new MeshBasicMaterial({
		color: 0x7a2048,
		wireframe: true,
		transparent: true,
		opacity: 0.2,
		depthWrite: false,
	});
	const wire = new Mesh(geometry, wireMaterial);
	wire.visible = false;
	wire.renderOrder = 2;
	jelly.add(wire);
	const floorGeometry = new PlaneGeometry(200, 200);
	const floorMaterial = new MeshPhysicalMaterial({
		color: 0x000000,
		emissive: 0xffffff,
		roughness: 1,
		specularIntensity: 0,
		envMapIntensity: 0,
		toneMapped: false,
	});
	const gridColor = { value: new Color() };
	const poolColor = { value: new Color() };
	floorMaterial.onBeforeCompile = (shader) => {
		shader.uniforms.gridColor = gridColor;
		shader.uniforms.poolColor = poolColor;
		shader.vertexShader = shader.vertexShader.replace(
			"#include <common>",
			"#include <common>\nvarying vec3 floorPosition;",
		);
		shader.vertexShader = shader.vertexShader.replace(
			"#include <begin_vertex>",
			"#include <begin_vertex>\nfloorPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;",
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <common>",
			"#include <common>\nvarying vec3 floorPosition;\nuniform vec3 gridColor;\nuniform vec3 poolColor;",
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <shadowmap_pars_fragment>",
			"#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>",
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <opaque_fragment>",
			`
			vec2 cell = floorPosition.xz / 0.6;
			vec2 edge = abs(fract(cell - 0.5) - 0.5) / max(fwidth(cell), vec2(0.0001));
			float grid = 1.0 - min(min(edge.x, edge.y), 1.0);
			float fade = 1.0 - smoothstep(4.0, 16.0, length(floorPosition.xz));
			float pool = 1.0 - smoothstep(2.0, 14.0, length(floorPosition.xz));
			outgoingLight = mix(outgoingLight, poolColor, pool);
			outgoingLight = mix(outgoingLight, gridColor, grid * fade * 0.25);
			outgoingLight *= 0.78 + 0.22 * getShadowMask();
			#include <opaque_fragment>
		`,
		);
	};
	const floor = new Mesh(floorGeometry, floorMaterial);
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = floorHeight - 0.1;
	floor.receiveShadow = true;
	scene.add(floor);
	const glassGeometry = new PlaneGeometry(200, 200);
	const glassMaterial = new MeshPhysicalMaterial({
		transmission: 1,
		thickness: 0.08,
		ior: 1.5,
		roughness: 0.12,
		envMapIntensity: 0.08,
	});
	const glass = new Mesh(glassGeometry, glassMaterial);
	glass.rotation.x = -Math.PI / 2;
	glass.position.y = floorHeight;
	scene.add(glass);
	let studio: Awaited<ReturnType<typeof loadJellyStudio>> | undefined;
	let darkTheme = false;

	const pointer = new Vector2();
	const raycaster = new Raycaster();
	const dragPlane = new Plane(new Vector3(0, 0, 1), 0);
	const cameraDirection = camera.getWorldDirection(new Vector3());
	const inverseRotation = new Quaternion();
	const anchor = new Vector3();
	const start = new Vector3();
	const hit = new Vector3();
	const target = new Vector3();
	const stretch = new Vector3();
	const tilt = new Vector2();
	let grabbed: number | null = null;
	let height = 0.5;
	let heightVelocity = 0;
	let frame = 0;
	let previousTime = 0;
	let activeUntil = 0;
	let reducedMotion = false;
	let visible = true;
	let disposed = false;
	let settings = defaultJellySettings;

	function render(time: number) {
		frame = 0;
		if (disposed || !visible || document.hidden) {
			return;
		}
		const dt = settings.paused
			? 0
			: Math.min((time - previousTime) / 1000 || 1 / 60, 0.06) *
				(settings.slow ? 0.25 : 1);
		previousTime = time;
		// Small integration steps keep the spring stable after a slow frame.
		const steps = Math.ceil(dt * 120);
		for (let step = 0; step < steps; step++) {
			const h = dt / steps;
			if (!reducedMotion && (height > 0 || heightVelocity > 0)) {
				heightVelocity -= 16 * h;
				height += heightVelocity * h;
				if (height < 0) {
					height = 0;
					physics.squish(Math.min(0.7, -heightVelocity * 0.16));
					heightVelocity = -heightVelocity * 0.3;
					if (heightVelocity < 0.5) {
						heightVelocity = 0;
					}
				}
			}
		}
		if (!reducedMotion && !settings.paused) {
			physics.update(dt);
		}
		jelly.position.y = height;
		if (reducedMotion) {
			jelly.rotation.set(0, -0.18, 0);
		} else {
			jelly.rotation.x += (tilt.y * 0.04 - jelly.rotation.x) * dt * 6;
			jelly.rotation.y += (-0.18 + tilt.x * 0.06 - jelly.rotation.y) * dt * 6;
		}
		renderer.render(scene, camera);
		if (
			!reducedMotion &&
			!settings.paused &&
			(grabbed !== null || physics.active || time < activeUntil)
		) {
			frame = requestAnimationFrame(render);
		}
	}

	function wake() {
		activeUntil = performance.now() + 3600;
		if (!frame && visible && !document.hidden && !disposed) {
			previousTime = performance.now();
			frame = requestAnimationFrame(render);
		}
	}

	function setTheme(dark: boolean) {
		darkTheme = dark;
		floorMaterial.emissive.set(dark ? 0x121214 : 0xffffff);
		gridColor.value.set(dark ? 0x4e4e58 : 0xa3a3ad);
		poolColor.value.set(dark ? 0x9797a1 : 0xffffff);
		renderer.toneMappingExposure = 1.12;
		wake();
	}

	function resize() {
		const { width, height } = canvas.getBoundingClientRect();
		if (!width || !height) {
			return;
		}
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		wake();
	}

	function updatePointer(event: PointerEvent) {
		const rect = canvas.getBoundingClientRect();
		pointer.set(
			((event.clientX - rect.left) / rect.width) * 2 - 1,
			-((event.clientY - rect.top) / rect.height) * 2 + 1,
		);
		raycaster.setFromCamera(pointer, camera);
	}

	function pointerDown(event: PointerEvent) {
		if (
			reducedMotion ||
			settings.paused ||
			grabbed !== null ||
			event.button !== 0
		) {
			return;
		}
		updatePointer(event);
		const intersection = raycaster.intersectObject(jelly)[0];
		if (!intersection) {
			return;
		}
		grabbed = event.pointerId;
		canvas.setPointerCapture(event.pointerId);
		canvas.style.cursor = "grabbing";
		anchor.copy(jelly.worldToLocal(intersection.point.clone()));
		const face = intersection.face;
		physics.grab(anchor, face ? [face.a, face.b, face.c] : undefined);
		dragPlane.setFromNormalAndCoplanarPoint(
			cameraDirection,
			intersection.point,
		);
		raycaster.ray.intersectPlane(dragPlane, start);
		target.set(0, 0, 0);
		wake();
	}

	function pointerMove(event: PointerEvent) {
		if (reducedMotion || settings.paused) {
			return;
		}
		updatePointer(event);
		if (grabbed === event.pointerId) {
			raycaster.ray.intersectPlane(dragPlane, hit);
			target.copy(hit).sub(start).clampLength(0, 1.5);
			target.applyQuaternion(inverseRotation.copy(jelly.quaternion).invert());
			physics.move(stretch.copy(anchor).add(target));
			wake();
		} else if (grabbed === null && event.pointerType !== "touch") {
			tilt.copy(pointer);
			canvas.style.cursor = raycaster.intersectObject(jelly).length
				? "grab"
				: "default";
			wake();
		}
	}

	function bounce() {
		if (!reducedMotion && !settings.paused) {
			physics.squish();
			heightVelocity = 2.8;
			wake();
		}
	}

	function release(event: PointerEvent) {
		if (grabbed !== event.pointerId) {
			return;
		}
		if (event.type === "pointerup" && target.length() < 0.08) {
			bounce();
		}
		resetDrag();
		wake();
	}

	function resetDrag() {
		const pointerId = grabbed;
		grabbed = null;
		physics.release();
		target.set(0, 0, 0);
		canvas.style.cursor = "default";
		if (pointerId !== null && canvas.hasPointerCapture(pointerId)) {
			canvas.releasePointerCapture(pointerId);
		}
	}

	function pointerLeave() {
		if (reducedMotion) {
			return;
		}
		tilt.set(0, 0);
		wake();
	}

	function visibilityChange() {
		if (document.hidden) {
			cancelAnimationFrame(frame);
			frame = 0;
			resetDrag();
		} else {
			wake();
		}
	}

	canvas.addEventListener("pointerdown", pointerDown);
	canvas.addEventListener("pointermove", pointerMove);
	canvas.addEventListener("pointerup", release);
	canvas.addEventListener("pointercancel", release);
	canvas.addEventListener("lostpointercapture", release);
	canvas.addEventListener("pointerleave", pointerLeave);
	document.addEventListener("visibilitychange", visibilityChange);
	const resizeObserver = new ResizeObserver(resize);
	resizeObserver.observe(canvas);
	const intersectionObserver = new IntersectionObserver(([entry]) => {
		visible = entry.isIntersecting;
		if (visible) {
			wake();
		} else {
			cancelAnimationFrame(frame);
			frame = 0;
		}
	});
	intersectionObserver.observe(canvas);
	const ready = loadJellyStudio(renderer, () => disposed).then(
		async (loaded) => {
			if (!loaded) {
				return;
			}
			studio = loaded;
			scene.environment = loaded.environment;
			setTheme(darkTheme);
			await renderer.compileAsync(scene, camera);
			wake();
		},
	);

	return {
		ready,
		setSettings(value: JellySettings) {
			settings = value;
			const flavor = jellyFlavors[value.flavor];
			material.color.set(flavor.surface);
			material.attenuationColor.setRGB(
				Math.exp(-flavor.absorption[0] * 0.035),
				Math.exp(-flavor.absorption[1] * 0.035),
				Math.exp(-flavor.absorption[2] * 0.035),
			);
			wireMaterial.color.set(flavor.swatch);
			wire.visible = value.wireframe;
			physics.configure(value.firmness, value.damping);
			if (value.paused) {
				resetDrag();
			}
			wake();
		},
		reset() {
			resetDrag();
			physics.reset();
			tilt.set(0, 0);
			height = heightVelocity = 0;
			jelly.rotation.set(0, -0.18, 0);
			wake();
		},
		setTheme,
		bounce,
		setReducedMotion(value: boolean) {
			reducedMotion = value;
			if (value) {
				resetDrag();
				stretch.set(0, 0, 0);
				physics.reset();
				tilt.set(0, 0);
				height = 0;
				heightVelocity = 0;
			}
			wake();
		},
		dispose() {
			if (disposed) {
				return;
			}
			disposed = true;
			resetDrag();
			cancelAnimationFrame(frame);
			resizeObserver.disconnect();
			intersectionObserver.disconnect();
			document.removeEventListener("visibilitychange", visibilityChange);
			canvas.removeEventListener("pointerdown", pointerDown);
			canvas.removeEventListener("pointermove", pointerMove);
			canvas.removeEventListener("pointerup", release);
			canvas.removeEventListener("pointercancel", release);
			canvas.removeEventListener("lostpointercapture", release);
			canvas.removeEventListener("pointerleave", pointerLeave);
			geometry.dispose();
			material.dispose();
			wireMaterial.dispose();
			floorGeometry.dispose();
			floorMaterial.dispose();
			glassGeometry.dispose();
			glassMaterial.dispose();
			keyLight.shadow.dispose();
			studio?.dispose();
			renderer.dispose();
		},
	};
}
