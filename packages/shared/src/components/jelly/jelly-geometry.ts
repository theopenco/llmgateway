/* eslint-disable no-mixed-operators -- Geometry and spring equations use standard arithmetic precedence. */

import { BufferAttribute, BufferGeometry, MeshBasicMaterial } from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

import { logoPaths } from "@/components/ui/logo-paths";

import type { Vector2 } from "three";

function distanceToOutline(x: number, y: number, points: Vector2[]) {
	let inside = false;
	let distance = Infinity;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const a = points[i];
		const b = points[j];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const t = Math.max(
			0,
			Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)),
		);
		distance = Math.min(
			distance,
			(x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2,
		);
		if (
			a.y > y !== b.y > y &&
			x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
		) {
			inside = !inside;
		}
	}
	return Math.sqrt(distance) * (inside ? -1 : 1);
}

export function createJellyGeometry() {
	const svg = new SVGLoader().parse(
		`<svg xmlns="http://www.w3.org/2000/svg">${logoPaths.map((d) => `<path d="${d}" />`).join("")}</svg>`,
	);
	const outlines = svg.paths.flatMap((path) =>
		path.subPaths.map((outline) =>
			outline
				.getPoints(12)
				.map((point) =>
					point.clone().set((point.x - 109) * 0.014, (116 - point.y) * 0.014),
				),
		),
	);
	const resolution = 96;
	const extent = 1.9;
	const placeholder = new MeshBasicMaterial();
	const surface = new MarchingCubes(
		resolution,
		placeholder,
		false,
		false,
		140000,
	);
	surface.isolation = 0;
	const footprint = new Float32Array(resolution * resolution);
	for (let y = 0; y < resolution; y++) {
		for (let x = 0; x < resolution; x++) {
			const px = ((x / resolution) * 2 - 1) * extent;
			const py = ((y / resolution) * 2 - 1) * extent;
			const distance = Math.min(
				...outlines.map((outline) => distanceToOutline(px, py, outline)),
			);
			footprint[x + y * resolution] = Math.exp(distance / 0.27);
		}
	}
	// Smooth the footprint before inflating it into a pillowed surface.
	for (let y = 0; y < resolution; y++) {
		for (let x = 0; x < resolution; x++) {
			let density = 0;
			let totalWeight = 0;
			for (let dy = -2; dy <= 2; dy++) {
				for (let dx = -2; dx <= 2; dx++) {
					const sx = Math.max(0, Math.min(resolution - 1, x + dx));
					const sy = Math.max(0, Math.min(resolution - 1, y + dy));
					const weight = Math.exp(-(dx * dx + dy * dy) / 2);
					density += footprint[sx + sy * resolution] * weight;
					totalWeight += weight;
				}
			}
			density /= totalWeight;
			const px = ((x / resolution) * 2 - 1) * extent;
			const py = ((y / resolution) * 2 - 1) * extent;
			const depth =
				1.18 * Math.sqrt(Math.max(0.15, 1 - (px / 2) ** 2 - (py / 2.3) ** 2));
			for (let z = 0; z < resolution; z++) {
				const pz = Math.abs(((z / resolution) * 2 - 1) * extent);
				surface.field[x + y * resolution + z * resolution * resolution] =
					1.12 - density - (pz / depth) ** 2;
			}
		}
	}
	surface.update();
	const geometry = new BufferGeometry();
	geometry.setAttribute(
		"position",
		new BufferAttribute(
			surface.geometry.attributes.position.array.slice(0, surface.count * 3),
			3,
		),
	);
	geometry.setAttribute(
		"normal",
		new BufferAttribute(
			surface.geometry.attributes.normal.array.slice(0, surface.count * 3),
			3,
		),
	);
	geometry.scale(extent, extent, extent);
	const merged = mergeVertices(geometry);
	const thickness = new Float32Array(merged.attributes.position.count);
	for (let i = 0; i < thickness.length; i++) {
		thickness[i] = Math.max(
			0.12,
			Math.abs(merged.attributes.position.getZ(i)) * 2,
		);
	}
	merged.setAttribute("jellyThickness", new BufferAttribute(thickness, 1));
	geometry.dispose();
	surface.geometry.dispose();
	placeholder.dispose();
	return merged;
}
