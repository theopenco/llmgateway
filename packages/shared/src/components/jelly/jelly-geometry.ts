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

function smoothMinimum(a: number, b: number, radius: number) {
	const blend = Math.max(radius - Math.abs(a - b), 0) / radius;
	return Math.min(a, b) - blend * blend * radius * 0.25;
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
	const resolution = 128;
	const extent = 1.9;
	const placeholder = new MeshBasicMaterial();
	const surface = new MarchingCubes(
		resolution,
		placeholder,
		false,
		false,
		250000,
	);
	surface.isolation = 0;
	const footprint = new Float32Array(resolution * resolution);
	const inset = new Float32Array(resolution * resolution);
	for (let y = 0; y < resolution; y++) {
		for (let x = 0; x < resolution; x++) {
			const px = ((x / resolution) * 2 - 1) * extent;
			const py = ((y / resolution) * 2 - 1) * extent;
			const distance = Math.min(
				distanceToOutline(px, py, outlines[0]),
				distanceToOutline(px, py, outlines[2]),
			);
			const doorway = distanceToOutline(px, py, outlines[1]);
			footprint[x + y * resolution] = Math.exp(
				Math.min(distance, doorway - 0.16) / 0.17,
			);
			inset[x + y * resolution] = doorway;
		}
	}
	// Smooth the footprint before inflating it into a pillowed surface.
	for (let y = 0; y < resolution; y++) {
		for (let x = 0; x < resolution; x++) {
			let density = 0;
			let insetDensity = 0;
			let totalWeight = 0;
			for (let dy = -4; dy <= 4; dy++) {
				for (let dx = -4; dx <= 4; dx++) {
					const sx = Math.max(0, Math.min(resolution - 1, x + dx));
					const sy = Math.max(0, Math.min(resolution - 1, y + dy));
					const weight = Math.exp(-(dx * dx + dy * dy) / 6);
					density += footprint[sx + sy * resolution] * weight;
					insetDensity += inset[sx + sy * resolution] * weight;
					totalWeight += weight;
				}
			}
			density /= totalWeight;
			insetDensity /= totalWeight;
			const px = ((x / resolution) * 2 - 1) * extent;
			const py = ((y / resolution) * 2 - 1) * extent;
			const depth =
				0.95 * Math.sqrt(Math.max(0.15, 1 - (px / 2) ** 2 - (py / 2.3) ** 2));
			// Carve a cavity into the connected solid, keeping its back wall attached.
			const insetDepth =
				-0.22 - 0.15 * (1 - Math.exp(Math.min(0, insetDensity) / 0.22));
			for (let z = 0; z < resolution; z++) {
				const pz = ((z / resolution) * 2 - 1) * extent;
				const cavity = -smoothMinimum(-insetDensity, pz - insetDepth, 0.12);
				surface.field[x + y * resolution + z * resolution * resolution] =
					smoothMinimum(1.12 - density - (pz / depth) ** 2, cavity, 0.08);
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
		const position = merged.attributes.position;
		const inDoorway =
			distanceToOutline(position.getX(i), position.getY(i), outlines[1]) < 0;
		thickness[i] = inDoorway
			? 0.6
			: Math.max(0.12, Math.abs(position.getZ(i)) * 2);
	}
	merged.setAttribute("jellyThickness", new BufferAttribute(thickness, 1));
	geometry.dispose();
	surface.geometry.dispose();
	placeholder.dispose();
	return merged;
}
