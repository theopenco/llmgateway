"use client";

/* eslint-disable no-mixed-operators -- spring/tilt math mixes arithmetic
 * operators, and prettier strips the clarifying parentheses the rule would
 * otherwise require (same trade-off as packages/db/src/logs.ts). */
import {
	Canvas,
	useFrame,
	useThree,
	type ThreeEvent,
} from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { buildPassportModel } from "./passport-data";
import {
	drawAirlinesPage,
	drawAirportsPage,
	drawBackCoverInner,
	drawBackCoverOuter,
	drawCoverInner,
	drawCoverOuter,
	drawEndorsementsPage,
	drawStampsPage,
	drawVisaPage,
} from "./passport-textures";

import type { ProfileData } from "@/components/profile/ProfileView";

const PASSPORT_W = 0.88;
const PASSPORT_H = 1.25;
const LEAF_GAP = 0.012;

/**
 * Slightly under-damped spring for lively page flips. Flip rotation runs
 * near-critical damping: larger overshoot rotates a landing page past flat
 * and clips it through the stack beneath.
 */
class Spring {
	public position: number;
	public velocity = 0;
	public target: number;
	public constructor(
		initial: number,
		private stiffness = 90,
		private damping = 12,
	) {
		this.position = initial;
		this.target = initial;
	}
	public update(dt: number): number {
		const clamped = Math.min(dt, 1 / 30);
		const force = -this.stiffness * (this.position - this.target);
		const dampingForce = -this.damping * this.velocity;
		this.velocity += (force + dampingForce) * clamped;
		this.position += this.velocity * clamped;
		return this.position;
	}
}

function canvasTexture(
	canvas: HTMLCanvasElement,
	gl: THREE.WebGLRenderer,
): THREE.CanvasTexture {
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = gl.capabilities.getMaxAnisotropy();
	// On dense displays the pages render near 1:1, where mipmapped trilinear
	// sampling only softens the print — plain linear sampling keeps the ink
	// crisp. Low-DPI screens minify ~3x, where mipmaps still prevent shimmer.
	if (gl.getPixelRatio() >= 1.5) {
		texture.generateMipmaps = false;
		texture.minFilter = THREE.LinearFilter;
	}
	return texture;
}

interface LeafSpec {
	front: THREE.CanvasTexture;
	back: THREE.CanvasTexture;
	isCover: boolean;
}

function Leaf({
	spec,
	index,
	turned,
	reducedMotion,
}: {
	spec: LeafSpec;
	index: number;
	turned: number;
	reducedMotion: boolean;
}) {
	const group = useRef<THREE.Group>(null);
	const rotSpring = useRef(new Spring(0, 80, 16));
	const zSpring = useRef(new Spring(-index * LEAF_GAP, 120, 16));

	useFrame((_, dt) => {
		const flipped = index < turned;
		// Left/right stack orders differ: the most recently turned leaf lies on
		// top of the left stack, the next unturned leaf on top of the right.
		const zTarget = flipped
			? -(turned - 1 - index) * LEAF_GAP
			: -(index - turned) * LEAF_GAP;
		const rotTarget = flipped
			? Math.max(-Math.PI, -Math.PI + 0.055 - 0.014 * (turned - 1 - index))
			: -0.01 * (index - turned);
		rotSpring.current.target = rotTarget;
		zSpring.current.target = zTarget;
		if (reducedMotion) {
			// Snap pages straight to their spread instead of animating the flip.
			rotSpring.current.position = rotTarget;
			rotSpring.current.velocity = 0;
			zSpring.current.position = zTarget;
			zSpring.current.velocity = 0;
		}
		if (group.current) {
			const rot = rotSpring.current.update(dt);
			const z = zSpring.current.update(dt);
			// Lift the leaf along its flight arc so a turning page clears the
			// settling stacks instead of clipping through neighbouring pages.
			const progress = THREE.MathUtils.clamp(-rot / Math.PI, 0, 1);
			const lift = Math.sin(progress * Math.PI) * 0.035;
			group.current.rotation.y = rot;
			group.current.position.z = z + lift;
		}
	});

	const w = spec.isCover ? PASSPORT_W * 1.04 : PASSPORT_W;
	const h = spec.isCover ? PASSPORT_H * 1.04 : PASSPORT_H;
	const sheetOffset = spec.isCover ? 0.0035 : 0.0018;

	return (
		<group ref={group}>
			<mesh position={[w / 2, 0, sheetOffset]}>
				<planeGeometry args={[w, h]} />
				<meshStandardMaterial
					map={spec.front}
					roughness={spec.isCover ? 0.62 : 0.88}
					metalness={spec.isCover ? 0.18 : 0}
				/>
			</mesh>
			<mesh position={[w / 2, 0, -sheetOffset]} rotation={[0, Math.PI, 0]}>
				<planeGeometry args={[w, h]} />
				<meshStandardMaterial
					map={spec.back}
					roughness={spec.isCover ? 0.62 : 0.88}
					metalness={spec.isCover ? 0.18 : 0}
				/>
			</mesh>
		</group>
	);
}

function Book({
	profile,
	turned,
	onAdvance,
	reducedMotion,
}: {
	profile: ProfileData;
	turned: number;
	onAdvance: (direction: 1 | -1) => void;
	reducedMotion: boolean;
}) {
	const group = useRef<THREE.Group>(null);
	const xSpring = useRef(new Spring(PASSPORT_W / -2, 60, 11));
	const pointer = useRef({ x: 0, y: 0 });
	const gl = useThree((state) => state.gl);

	const leaves = useMemo<LeafSpec[]>(() => {
		const data = buildPassportModel(profile);
		return [
			{
				front: canvasTexture(drawCoverOuter(), gl),
				back: canvasTexture(drawCoverInner(), gl),
				isCover: true,
			},
			{
				front: canvasTexture(drawVisaPage(data), gl),
				back: canvasTexture(drawAirportsPage(data.airports), gl),
				isCover: false,
			},
			{
				front: canvasTexture(drawAirlinesPage(data.airlines), gl),
				back: canvasTexture(drawStampsPage(data.stamps.slice(0, 3), 0), gl),
				isCover: false,
			},
			{
				front: canvasTexture(drawStampsPage(data.stamps.slice(3, 6), 1), gl),
				back: canvasTexture(drawEndorsementsPage(data), gl),
				isCover: false,
			},
			{
				front: canvasTexture(drawBackCoverInner(), gl),
				back: canvasTexture(drawBackCoverOuter(), gl),
				isCover: true,
			},
		];
	}, [profile, gl]);

	useEffect(() => {
		const specs = leaves;
		return () => {
			for (const leaf of specs) {
				leaf.front.dispose();
				leaf.back.dispose();
			}
		};
	}, [leaves]);

	useFrame((state, dt) => {
		if (!group.current) {
			return;
		}
		// Open books centre on the spine; a closed passport centres its cover.
		xSpring.current.target = turned === 0 ? -PASSPORT_W / 2 : 0;
		if (reducedMotion) {
			xSpring.current.position = xSpring.current.target;
			xSpring.current.velocity = 0;
		}
		group.current.position.x = xSpring.current.update(dt);

		const t = state.clock.getElapsedTime();
		// Reduced motion keeps the book perfectly still: no float, no invite
		// wobble, and no pointer-follow tilt.
		const float = reducedMotion ? 0 : 1;
		group.current.position.y = Math.sin(t * 0.9) * 0.015 * float;
		const invite = turned === 0 ? Math.sin(t * 0.7) * 0.05 * float : 0;
		const targetRotY = pointer.current.x * 0.22 * float + invite;
		const targetRotX = -0.1 - pointer.current.y * 0.14 * float;
		group.current.rotation.y +=
			(targetRotY - group.current.rotation.y) * Math.min(1, dt * 5);
		group.current.rotation.x +=
			(targetRotX - group.current.rotation.x) * Math.min(1, dt * 5);
		group.current.rotation.z = Math.sin(t * 0.6) * 0.008 * float;
	});

	const handleClick = (event: ThreeEvent<MouseEvent>) => {
		event.stopPropagation();
		if (turned === 0) {
			onAdvance(1);
			return;
		}
		// Click the left page to flip back, the right page to move on.
		onAdvance(event.point.x < 0 ? -1 : 1);
	};

	return (
		<group
			ref={group}
			onClick={handleClick}
			onPointerMove={(event) => {
				pointer.current = { x: event.pointer.x, y: event.pointer.y };
			}}
			onPointerOver={() => {
				document.body.style.cursor = "pointer";
			}}
			onPointerOut={() => {
				pointer.current = { x: 0, y: 0 };
				document.body.style.cursor = "auto";
			}}
		>
			{leaves.map((leaf, i) => (
				<Leaf
					key={i}
					spec={leaf}
					index={i}
					turned={turned}
					reducedMotion={reducedMotion}
				/>
			))}
		</group>
	);
}

export default function PassportCanvas({
	profile,
	turned,
	onAdvance,
}: {
	profile: ProfileData;
	turned: number;
	onAdvance: (direction: 1 | -1) => void;
}) {
	const [reducedMotion, setReducedMotion] = useState(false);

	useEffect(() => {
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReducedMotion(query.matches);
		const listener = (event: MediaQueryListEvent) =>
			setReducedMotion(event.matches);
		query.addEventListener("change", listener);
		return () => query.removeEventListener("change", listener);
	}, []);

	return (
		<Canvas
			camera={{ fov: 38, position: [0, 0.1, 2.75] }}
			dpr={[1, 3]}
			gl={{ antialias: true, alpha: true }}
			style={{ touchAction: "pan-y" }}
		>
			<ambientLight intensity={1.15} />
			<directionalLight position={[2.2, 3, 4]} intensity={1.5} />
			<directionalLight position={[-3, -1, 2]} intensity={0.35} />
			<Book
				profile={profile}
				turned={turned}
				onAdvance={onAdvance}
				reducedMotion={reducedMotion}
			/>
		</Canvas>
	);
}
