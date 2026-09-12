/* eslint-disable no-mixed-operators -- Constraint equations use standard arithmetic precedence. */

import { Triangle, Vector3 } from "three";

import type { BufferGeometry } from "three";

const divisions = 6;
const side = divisions + 1;
const step = 1 / 120;

export class JellyPhysics {
	private readonly rest: Float32Array;
	private readonly points: Float32Array;
	private readonly previous: Float32Array;
	private readonly velocity: Float32Array;
	private readonly surface: Float32Array;
	private readonly normals: Float32Array;
	private readonly bindings: Uint16Array;
	private readonly weights: Float32Array;
	private readonly edges: {
		a: number;
		b: number;
		length: number;
		lambda: number;
	}[] = [];
	private readonly cells: { ids: number[]; volume: number; lambda: number }[] =
		[];
	private readonly minimum = new Vector3();
	private readonly spacing = new Vector3();
	private readonly gradients = new Float64Array(12);
	private readonly normalTransforms = new Float32Array(side ** 3 * 9);
	private readonly gripIds = new Uint16Array(24);
	private readonly gripWeights = new Float32Array(24);
	private gripCount = 0;
	private readonly gripTarget = new Vector3();
	private gripping = false;
	private accumulator = 0;
	private sleeping = true;
	private firmness = 1.2;
	private damping = 3;

	configure(firmness: number, damping: number) {
		this.firmness = firmness;
		this.damping = damping;
	}

	get active() {
		return !this.sleeping;
	}

	constructor(private readonly geometry: BufferGeometry) {
		geometry.computeBoundingBox();
		const bounds = geometry.boundingBox!;
		this.minimum.copy(bounds.min);
		this.spacing.subVectors(bounds.max, bounds.min).divideScalar(divisions);
		this.rest = new Float32Array(side ** 3 * 3);
		for (let z = 0; z < side; z++) {
			for (let y = 0; y < side; y++) {
				for (let x = 0; x < side; x++) {
					const i = (x + y * side + z * side * side) * 3;
					this.rest[i] = bounds.min.x + x * this.spacing.x;
					this.rest[i + 1] = bounds.min.y + y * this.spacing.y;
					this.rest[i + 2] = bounds.min.z + z * this.spacing.z;
				}
			}
		}
		this.points = this.rest.slice();
		this.previous = this.rest.slice();
		this.velocity = new Float32Array(this.rest.length);
		this.surface = new Float32Array(geometry.attributes.position.array);
		this.normals = new Float32Array(geometry.attributes.normal.array);
		this.bindings = new Uint16Array(geometry.attributes.position.count * 8);
		this.weights = new Float32Array(this.bindings.length);
		const point = new Vector3();
		for (let i = 0; i < geometry.attributes.position.count; i++) {
			point.fromArray(this.surface, i * 3);
			this.bind(point, this.bindings, this.weights, i * 8);
		}
		const uniqueEdges = new Set<string>();
		for (let z = 0; z < divisions; z++) {
			for (let y = 0; y < divisions; y++) {
				for (let x = 0; x < divisions; x++) {
					const a = x + y * side + z * side * side;
					const corners = [
						a,
						a + 1,
						a + side,
						a + side + 1,
						a + side * side,
						a + side * side + 1,
						a + side * side + side,
						a + side * side + side + 1,
					];
					for (const indices of [
						[0, 1, 3, 7],
						[0, 3, 2, 7],
						[0, 2, 6, 7],
						[0, 6, 4, 7],
						[0, 4, 5, 7],
						[0, 5, 1, 7],
					]) {
						const ids = indices.map((index) => corners[index] * 3);
						this.cells.push({ ids, volume: this.volume(ids), lambda: 0 });
						for (let i = 0; i < 4; i++) {
							for (let j = i + 1; j < 4; j++) {
								const low = Math.min(ids[i], ids[j]);
								const high = Math.max(ids[i], ids[j]);
								const key = `${low}:${high}`;
								if (!uniqueEdges.has(key)) {
									uniqueEdges.add(key);
									this.edges.push({
										a: low,
										b: high,
										length: Math.hypot(
											this.rest[high] - this.rest[low],
											this.rest[high + 1] - this.rest[low + 1],
											this.rest[high + 2] - this.rest[low + 2],
										),
										lambda: 0,
									});
								}
							}
						}
					}
				}
			}
		}
	}

	private bind(
		point: Vector3,
		ids: Uint16Array,
		weights: Float32Array,
		offset = 0,
	) {
		const coordinates = [point.x, point.y, point.z].map((value, axis) =>
			Math.max(
				0,
				Math.min(
					divisions - 0.00001,
					(value - this.minimum.getComponent(axis)) /
						this.spacing.getComponent(axis),
				),
			),
		);
		const cell = coordinates.map(Math.floor);
		const fraction = coordinates.map((value, axis) => value - cell[axis]);
		for (let i = 0; i < 8; i++) {
			const x = i & 1;
			const y = (i >> 1) & 1;
			const z = (i >> 2) & 1;
			ids[offset + i] =
				(cell[0] + x + (cell[1] + y) * side + (cell[2] + z) * side * side) * 3;
			weights[offset + i] =
				(x ? fraction[0] : 1 - fraction[0]) *
				(y ? fraction[1] : 1 - fraction[1]) *
				(z ? fraction[2] : 1 - fraction[2]);
		}
	}

	private volume(ids: number[]) {
		const [a, b, c, d] = ids;
		const p = this.points;
		const bx = p[b] - p[a],
			by = p[b + 1] - p[a + 1],
			bz = p[b + 2] - p[a + 2];
		const cx = p[c] - p[a],
			cy = p[c + 1] - p[a + 1],
			cz = p[c + 2] - p[a + 2];
		const dx = p[d] - p[a],
			dy = p[d + 1] - p[a + 1],
			dz = p[d + 2] - p[a + 2];
		const g = this.gradients;
		g[3] = (cy * dz - cz * dy) / 6;
		g[4] = (cz * dx - cx * dz) / 6;
		g[5] = (cx * dy - cy * dx) / 6;
		g[6] = (dy * bz - dz * by) / 6;
		g[7] = (dz * bx - dx * bz) / 6;
		g[8] = (dx * by - dy * bx) / 6;
		g[9] = (by * cz - bz * cy) / 6;
		g[10] = (bz * cx - bx * cz) / 6;
		g[11] = (bx * cy - by * cx) / 6;
		for (let axis = 0; axis < 3; axis++) {
			g[axis] = -g[axis + 3] - g[axis + 6] - g[axis + 9];
		}
		return bx * g[3] + by * g[4] + bz * g[5];
	}

	grab(point: Vector3, triangle?: [number, number, number]) {
		if (triangle) {
			const positions = this.geometry.attributes.position;
			const corners = triangle.map((index) =>
				new Vector3().fromBufferAttribute(positions, index),
			);
			const barycentric = Triangle.getBarycoord(
				point,
				corners[0],
				corners[1],
				corners[2],
				new Vector3(),
			);
			if (!barycentric) {
				return;
			}
			const weights = new Map<number, number>();
			for (let corner = 0; corner < 3; corner++) {
				for (let j = 0; j < 8; j++) {
					const binding = triangle[corner] * 8 + j;
					const id = this.bindings[binding];
					weights.set(
						id,
						(weights.get(id) ?? 0) +
							this.weights[binding] * barycentric.getComponent(corner),
					);
				}
			}
			this.gripCount = 0;
			weights.forEach((weight, id) => {
				this.gripIds[this.gripCount] = id;
				this.gripWeights[this.gripCount++] = weight;
			});
		} else {
			this.bind(point, this.gripIds, this.gripWeights);
			this.gripCount = 8;
		}
		this.gripTarget.copy(point);
		this.gripping = true;
		this.sleeping = false;
	}

	move(point: Vector3) {
		this.gripTarget.copy(point);
	}

	release() {
		this.gripping = false;
	}

	squish(strength = 1) {
		this.sleeping = false;
		for (let i = 0; i < this.velocity.length; i += 3) {
			this.velocity[i] = Math.max(
				-4,
				Math.min(4, this.velocity[i] + this.rest[i] * 1.8 * strength),
			);
			this.velocity[i + 1] = Math.max(
				-4,
				this.velocity[i + 1] -
					(this.rest[i + 1] - this.minimum.y) * 2 * strength,
			);
			this.velocity[i + 2] = Math.max(
				-4,
				Math.min(4, this.velocity[i + 2] + this.rest[i + 2] * 1.8 * strength),
			);
		}
	}

	update(dt: number) {
		if (this.sleeping) {
			return;
		}
		this.accumulator = Math.min(this.accumulator + dt, step * 6);
		while (this.accumulator >= step) {
			this.accumulator -= step;
			this.integrate();
		}
		if (
			!this.gripping &&
			this.points.every(
				(value, i) =>
					Math.abs(value - this.rest[i]) < 0.002 &&
					Math.abs(this.velocity[i]) < 0.01,
			)
		) {
			this.reset();
			return;
		}
		this.updateNormalTransforms();
		const positions = this.geometry.attributes.position;
		const normals = this.geometry.attributes.normal;
		for (let i = 0; i < positions.count; i++) {
			let x = 0,
				y = 0,
				z = 0;
			let nx = 0,
				ny = 0,
				nz = 0;
			const rx = this.normals[i * 3],
				ry = this.normals[i * 3 + 1],
				rz = this.normals[i * 3 + 2];
			for (let j = 0; j < 8; j++) {
				const id = this.bindings[i * 8 + j];
				const weight = this.weights[i * 8 + j];
				x += this.points[id] * weight;
				y += this.points[id + 1] * weight;
				z += this.points[id + 2] * weight;
				const k = id * 3;
				const n = this.normalTransforms;
				nx += (n[k] * rx + n[k + 1] * ry + n[k + 2] * rz) * weight;
				ny += (n[k + 3] * rx + n[k + 4] * ry + n[k + 5] * rz) * weight;
				nz += (n[k + 6] * rx + n[k + 7] * ry + n[k + 8] * rz) * weight;
			}
			positions.setXYZ(i, x, y, z);
			const length = Math.hypot(nx, ny, nz) || 1;
			normals.setXYZ(i, nx / length, ny / length, nz / length);
		}
		positions.needsUpdate = true;
		normals.needsUpdate = true;
		this.geometry.computeBoundingSphere();
	}

	private updateNormalTransforms() {
		const p = this.points;
		const matrix = new Array<number>(9).fill(0);
		for (let id = 0; id < p.length / 3; id++) {
			const coordinates = [
				id % side,
				Math.floor(id / side) % side,
				Math.floor(id / (side * side)),
			];
			for (let axis = 0; axis < 3; axis++) {
				const stride = side ** axis;
				const low = coordinates[axis] > 0 ? id - stride : id;
				const high = coordinates[axis] < divisions ? id + stride : id;
				const scale = stride / ((high - low) * this.spacing.getComponent(axis));
				for (let row = 0; row < 3; row++) {
					matrix[row * 3 + axis] =
						(p[high * 3 + row] - p[low * 3 + row]) * scale;
				}
			}
			const [a, b, c, d, e, f, g, h, i] = matrix;
			const k = id * 9,
				n = this.normalTransforms;
			n[k] = e * i - f * h;
			n[k + 1] = f * g - d * i;
			n[k + 2] = d * h - e * g;
			n[k + 3] = c * h - b * i;
			n[k + 4] = a * i - c * g;
			n[k + 5] = b * g - a * h;
			n[k + 6] = b * f - c * e;
			n[k + 7] = c * d - a * f;
			n[k + 8] = a * e - b * d;
		}
	}

	private integrate() {
		const p = this.points;
		this.previous.set(p);
		for (let i = 0; i < p.length; i++) {
			this.velocity[i] =
				(this.velocity[i] + (this.rest[i] - p[i]) * 15 * this.firmness * step) *
				Math.exp(-this.damping * step);
			p[i] += this.velocity[i] * step;
		}
		for (const edge of this.edges) {
			edge.lambda = 0;
		}
		for (const cell of this.cells) {
			cell.lambda = 0;
		}
		for (let iteration = 0; iteration < 3; iteration++) {
			const edgeAlpha = 0.0018 / (this.firmness * step * step);
			for (const edge of this.edges) {
				const { a, b } = edge;
				const dx = p[b] - p[a],
					dy = p[b + 1] - p[a + 1],
					dz = p[b + 2] - p[a + 2];
				const length = Math.hypot(dx, dy, dz) || 0.00001;
				const delta =
					-(length - edge.length + edgeAlpha * edge.lambda) / (2 + edgeAlpha);
				edge.lambda += delta;
				const scale = delta / length;
				p[a] -= dx * scale;
				p[a + 1] -= dy * scale;
				p[a + 2] -= dz * scale;
				p[b] += dx * scale;
				p[b + 1] += dy * scale;
				p[b + 2] += dz * scale;
			}
			const volumeAlpha = 0.000001 / (step * step);
			for (const cell of this.cells) {
				const volume = this.volume(cell.ids);
				let denominator = volumeAlpha;
				for (let i = 0; i < this.gradients.length; i++) {
					denominator += this.gradients[i] ** 2;
				}
				const delta =
					-(volume - cell.volume + volumeAlpha * cell.lambda) / denominator;
				cell.lambda += delta;
				for (let node = 0; node < 4; node++) {
					for (let axis = 0; axis < 3; axis++) {
						p[cell.ids[node] + axis] += this.gradients[node * 3 + axis] * delta;
					}
				}
			}
			if (this.gripping) {
				for (let axis = 0; axis < 3; axis++) {
					let current = 0,
						denominator = 0.025;
					for (let j = 0; j < this.gripCount; j++) {
						current += p[this.gripIds[j] + axis] * this.gripWeights[j];
						denominator += this.gripWeights[j] ** 2;
					}
					const correction = Math.max(
						-0.035,
						Math.min(
							0.035,
							(this.gripTarget.getComponent(axis) - current) / denominator,
						),
					);
					for (let j = 0; j < this.gripCount; j++) {
						p[this.gripIds[j] + axis] += this.gripWeights[j] * correction;
					}
				}
			}
			for (let i = 1; i < p.length; i += 3) {
				p[i] = Math.max(this.minimum.y, p[i]);
			}
		}
		for (let i = 0; i < p.length; i++) {
			this.velocity[i] = (p[i] - this.previous[i]) / step;
		}
	}

	reset() {
		this.sleeping = true;
		this.gripping = false;
		this.accumulator = 0;
		this.points.set(this.rest);
		this.velocity.fill(0);
		this.geometry.attributes.position.array.set(this.surface);
		this.geometry.attributes.normal.array.set(this.normals);
		this.geometry.attributes.position.needsUpdate = true;
		this.geometry.attributes.normal.needsUpdate = true;
		this.geometry.computeBoundingSphere();
	}
}
