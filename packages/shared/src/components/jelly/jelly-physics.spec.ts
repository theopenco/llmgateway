import { BoxGeometry, Vector3 } from "three";
import { describe, expect, test } from "vitest";

import { JellyPhysics } from "./jelly-physics";

import type { BufferGeometry } from "three";

function specimen() {
	const geometry = new BoxGeometry(3, 3.2, 1.6, 6, 6, 4);
	return { geometry, physics: new JellyPhysics(geometry) };
}

function volume(geometry: BufferGeometry) {
	const positions = geometry.attributes.position;
	const index = geometry.index!;
	const a = new Vector3();
	const b = new Vector3();
	const c = new Vector3();
	let total = 0;
	for (let i = 0; i < index.count; i += 3) {
		a.fromBufferAttribute(positions, index.getX(i));
		b.fromBufferAttribute(positions, index.getX(i + 1));
		c.fromBufferAttribute(positions, index.getX(i + 2));
		total += a.dot(b.cross(c)) / 6;
	}
	return Math.abs(total);
}

describe("jelly physics", () => {
	test("preserves volume during a nudge and settles to the logo", () => {
		const { geometry, physics } = specimen();
		const rest = geometry.attributes.position.array.slice();
		const restVolume = volume(geometry);
		physics.squish();
		for (let i = 0; i < 60; i++) {
			physics.update(1 / 60);
			expect(volume(geometry) / restVolume).toBeGreaterThan(0.88);
			expect(volume(geometry) / restVolume).toBeLessThan(1.12);
		}
		for (let i = 0; i < 1200 && physics.active; i++) {
			physics.update(1 / 60);
		}
		expect(physics.active).toBe(false);
		expect(geometry.attributes.position.array).toEqual(rest);
		geometry.dispose();
	});

	test("keeps a stretched surface above the table with unit normals", () => {
		const { geometry, physics } = specimen();
		physics.configure(0.4, 0.5);
		physics.grab(new Vector3(1, 1, 0.7));
		physics.move(new Vector3(2.1, 1.8, 1.2));
		for (let i = 0; i < 90; i++) {
			physics.update(1 / 60);
		}
		const positions = geometry.attributes.position;
		const normals = geometry.attributes.normal;
		const normal = new Vector3();
		for (let i = 0; i < positions.count; i++) {
			expect(positions.getY(i)).toBeGreaterThanOrEqual(-1.6001);
			expect(Math.abs(positions.getX(i))).toBeLessThan(4);
			expect(Math.abs(positions.getZ(i))).toBeLessThan(3);
			expect(normal.fromBufferAttribute(normals, i).length()).toBeCloseTo(1, 5);
		}
		physics.release();
		physics.reset();
		expect(physics.active).toBe(false);
		geometry.dispose();
	});

	test("repeated nudges stay bounded and reset restores the surface", () => {
		const { geometry, physics } = specimen();
		const positions = geometry.attributes.position.array.slice();
		const normals = geometry.attributes.normal.array.slice();
		for (let i = 0; i < 100; i++) {
			physics.squish();
		}
		physics.update(10);
		expect(
			Array.from(geometry.attributes.position.array).every(
				(v) => Number.isFinite(v) && Math.abs(v) < 4,
			),
		).toBe(true);
		physics.reset();
		physics.update(1);
		expect(geometry.attributes.position.array).toEqual(positions);
		expect(geometry.attributes.normal.array).toEqual(normals);
		geometry.dispose();
	});

	test("produces the same motion at 30 and 60 frames per second", () => {
		const slow = specimen();
		const fast = specimen();
		slow.physics.squish();
		fast.physics.squish();
		for (let i = 0; i < 30; i++) {
			slow.physics.update(1 / 30);
		}
		for (let i = 0; i < 60; i++) {
			fast.physics.update(1 / 60);
		}
		expect(slow.geometry.attributes.position.array).toEqual(
			fast.geometry.attributes.position.array,
		);
		slow.geometry.dispose();
		fast.geometry.dispose();
	});
});
