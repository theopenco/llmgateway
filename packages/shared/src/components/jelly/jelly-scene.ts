/* eslint-disable no-mixed-operators -- Geometry and spring equations use standard arithmetic precedence. */

import {
	ACESFilmicToneMapping,
	Color,
	DoubleSide,
	Mesh,
	MeshPhysicalMaterial,
	PerspectiveCamera,
	Plane,
	PlaneGeometry,
	Quaternion,
	Raycaster,
	Scene,
	ShaderChunk,
	Vector2,
	Vector3,
	WebGLRenderer,
} from "three";
import { Reflector } from "three/addons/objects/Reflector.js";

import { createJellyGeometry } from "./jelly-geometry";
import { JellyPhysics } from "./jelly-physics";
import { loadJellyStudio } from "./jelly-studio";

import type { ShaderMaterial } from "three";

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
	const scene = new Scene();
	const camera = new PerspectiveCamera(34, 1, 0.1, 40);
	camera.position.set(0, 3.5, 9.8);
	camera.zoom = 1.35;
	camera.lookAt(0, 0, 0);
	let studio: Awaited<ReturnType<typeof loadJellyStudio>>;
	scene.environmentRotation.set(0, 0.65, 0);
	const geometry = createJellyGeometry();
	const physics = new JellyPhysics(geometry);
	const floorHeight = geometry.boundingBox!.min.y - 0.012;
	const backdrop = { value: new Color(0.003, 0.003, 0.003) };
	const material = new MeshPhysicalMaterial({
		side: DoubleSide,
		color: 0xffffff,
		metalness: 0,
		roughness: 0.065,
		transmission: 1,
		thickness: 1.8,
		ior: 1.335,
		dispersion: 0.008,
		clearcoat: 0,
		attenuationColor: new Color(0xfcfcfc),
		attenuationDistance: 4,
		envMapIntensity: 0.85,
	});
	material.onBeforeCompile = (shader) => {
		shader.uniforms.jellyBackdrop = backdrop;
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
			"#include <common>\nvarying float vJellyThickness;\nuniform vec3 jellyBackdrop;",
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <transmission_pars_fragment>",
			ShaderChunk.transmission_pars_fragment
				.replace("vec4 transmittedLight;", "vec4 transmittedLight = vec4(0.0);")
				.replace(
					"vec3 attenuatedColor = transmittance * transmittedLight.rgb;",
					`#ifdef ENVMAP_TYPE_CUBE_UV
					vec3 refractionDirection = normalize(refract(-v, n, 1.0 / ior));
					vec3 studioLight = textureCubeUV(envMap, envMapRotation * refractionDirection, roughness).rgb * envMapIntensity;
					float scattering = 1.0 - exp(-thickness * 0.055);
					// Undo Three's half-opaque white transmission clear before compositing.
					float coverage = clamp(transmittedLight.a * 2.0 - 1.0, 0.0, 1.0);
					vec3 screenLight = max(vec3(0.0), transmittedLight.rgb - vec3(0.5) * (1.0 - coverage));
					vec3 clearLight = mix(jellyBackdrop, studioLight, 0.14);
					clearLight = mix(clearLight, vec3(0.18), scattering);
					transmittedLight.rgb = clearLight * (1.0 - coverage) + screenLight;
					transmittedLight.a = 1.0;
				#endif
				vec3 attenuatedColor = transmittance * transmittedLight.rgb;`,
				),
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
	scene.add(jelly);
	const glassGeometry = new PlaneGeometry(20, 20);
	const glass = new Reflector(glassGeometry, {
		textureWidth: 512,
		textureHeight: 512,
		clipBias: 0.003,
		multisample: 0,
	});
	const glassMaterial = glass.material as ShaderMaterial;
	glassMaterial.transparent = true;
	glassMaterial.depthWrite = false;
	glassMaterial.vertexShader = glassMaterial.vertexShader
		.replace(
			"varying vec4 vUv;",
			"varying vec4 vUv;\nvarying vec2 vFloorPosition;",
		)
		.replace(
			"vUv = textureMatrix",
			"vFloorPosition = position.xy;\nvUv = textureMatrix",
		);
	glassMaterial.fragmentShader = glassMaterial.fragmentShader.replace(
		"varying vec4 vUv;",
		"varying vec4 vUv;\nvarying vec2 vFloorPosition;",
	);
	glassMaterial.fragmentShader = glassMaterial.fragmentShader.replace(
		"gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );",
		"gl_FragColor = vec4(base.rgb, base.a * 0.12 * (1.0 - smoothstep(0.5, 3.0, length(vFloorPosition))));",
	);
	glass.rotation.x = -Math.PI / 2;
	glass.position.y = floorHeight;
	scene.add(glass);

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
	let hoverPending = false;
	let height = 0.5;
	let heightVelocity = 0;
	let frame = 0;
	let previousTime = 0;
	let activeUntil = 0;
	let reducedMotion = false;
	let visible = true;
	let disposed = false;

	function render(time: number) {
		frame = 0;
		if (disposed || !visible || document.hidden) {
			return;
		}
		const dt = Math.min((time - previousTime) / 1000 || 1 / 60, 0.06);
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
		if (!reducedMotion) {
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
		if (hoverPending && grabbed === null && !reducedMotion) {
			hoverPending = false;
			raycaster.setFromCamera(pointer, camera);
			canvas.style.cursor = raycaster.intersectObject(jelly).length
				? "grab"
				: "default";
		}
		if (
			!reducedMotion &&
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
		backdrop.value.setScalar(dark ? 0.003 : 0.9);
		material.envMapIntensity = dark ? 0.85 : 1.0;
		renderer.toneMappingExposure = dark ? 1.1 : 1.0;
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
		if (reducedMotion || grabbed !== null || event.button !== 0) {
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
		if (reducedMotion) {
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
			hoverPending = true;
			wake();
		}
	}

	function bounce() {
		if (!reducedMotion) {
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
		hoverPending = false;
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
		hoverPending = false;
		if (grabbed === null) {
			canvas.style.cursor = "default";
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
	const ready = loadJellyStudio(renderer, () => disposed).then((loaded) => {
		if (loaded && !disposed) {
			studio = loaded;
			scene.environment = loaded.environment;
			renderer.compile(scene, camera);
			wake();
		}
	});

	return {
		ready,
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
			glassGeometry.dispose();
			glass.dispose();
			studio?.dispose();
			renderer.dispose();
		},
	};
}
