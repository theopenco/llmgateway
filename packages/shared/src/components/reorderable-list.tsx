"use client";

import { GripVertical } from "lucide-react";
import { Reorder, useDragControls, useReducedMotion } from "motion/react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

/**
 * Drag-to-reorder list.
 *
 * Both `Reorder.Group` and `Reorder.Item` live in this one file on purpose:
 * they talk to each other through a React context, so if two apps resolved
 * different copies of motion the drag would silently never register an item.
 * Consumers import this component, never `Reorder` directly.
 *
 * Also carries the keyboard story. Motion's `Reorder` is pointer-only, and the
 * order here decides which provider key serves live traffic — a control that
 * important cannot be mouse-only.
 */

interface ReorderContextValue {
	ids: string[];
	onReorder: (ids: string[]) => void;
	commit: (ids: string[]) => void;
	disabled: boolean;
	instructionsId: string;
	announce: (message: string) => void;
}

const ReorderableContext = createContext<ReorderContextValue | null>(null);

function useReorderable(): ReorderContextValue {
	const context = useContext(ReorderableContext);
	if (!context) {
		throw new Error("ReorderableItem must be rendered inside ReorderableList");
	}
	return context;
}

export interface ReorderableListProps {
	/**
	 * Ordered ids. Strings, never objects: `Reorder.Group` matches items with
	 * `indexOf`, so a value whose identity changes on re-render drops out.
	 */
	ids: string[];
	/** Fires continuously during a drag and on every keyboard move. */
	onReorder: (ids: string[]) => void;
	/** Fires once the gesture settles — persist here. */
	onCommit: (ids: string[]) => void;
	/** `div` for card lists, `tbody` for tables. */
	as?: "div" | "tbody";
	className?: string;
	/** Hides handles and blocks moves, e.g. while a save is in flight. */
	disabled?: boolean;
	children: ReactNode;
}

/** Keyboard moves fire one at a time; hold-to-repeat must not fire one save per press. */
const KEYBOARD_COMMIT_DELAY_MS = 600;

export function ReorderableList({
	ids,
	onReorder,
	onCommit,
	as = "div",
	className,
	disabled = false,
	children,
}: ReorderableListProps) {
	const [announcement, setAnnouncement] = useState("");
	// The assistive nodes below cannot live next to the group: with as="tbody"
	// they would be direct children of <table>, which is invalid HTML and fails
	// hydration. They are portalled to the body instead — aria-describedby and
	// aria-live work by id, not by proximity. Client-only, hence the mount flag.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Order awaiting its debounced save. Kept in a ref (with the latest
	// onCommit) so unmount can flush it: the optimistic order has already been
	// applied via onReorder, and discarding the save would leave the UI showing
	// a priority the server never received.
	const pendingCommit = useRef<string[] | null>(null);
	const onCommitRef = useRef(onCommit);
	onCommitRef.current = onCommit;
	const instructionsId = `reorder-instructions-${ids[0] ?? "empty"}`;

	useEffect(
		() => () => {
			if (commitTimer.current) {
				clearTimeout(commitTimer.current);
			}
			if (pendingCommit.current) {
				onCommitRef.current(pendingCommit.current);
				pendingCommit.current = null;
			}
		},
		[],
	);

	const commit = useCallback(
		(next: string[]) => {
			if (commitTimer.current) {
				clearTimeout(commitTimer.current);
			}
			pendingCommit.current = next;
			commitTimer.current = setTimeout(() => {
				pendingCommit.current = null;
				onCommit(next);
			}, KEYBOARD_COMMIT_DELAY_MS);
		},
		[onCommit],
	);

	// Fewer than two items has nothing to reorder, so the handle would be a
	// dead control.
	const effectivelyDisabled = disabled || ids.length < 2;

	const context: ReorderContextValue = {
		ids,
		onReorder,
		commit,
		disabled: effectivelyDisabled,
		instructionsId,
		announce: setAnnouncement,
	};

	return (
		<>
			<Reorder.Group
				axis="y"
				as={as}
				values={ids}
				onReorder={onReorder}
				className={className}
			>
				<ReorderableContext.Provider value={context}>
					{children}
				</ReorderableContext.Provider>
			</Reorder.Group>
			{mounted &&
				createPortal(
					<>
						<span id={instructionsId} className="sr-only">
							Press the Up and Down arrow keys to move this item. Changes save
							automatically.
						</span>
						<span aria-live="polite" className="sr-only">
							{announcement}
						</span>
					</>,
					document.body,
				)}
		</>
	);
}

export interface ReorderableItemProps {
	id: string;
	as?: "div" | "tr";
	className?: string;
	/** Announced identity, e.g. "OpenAI key sk-…4f2". */
	itemLabel: string;
	/** Receives the drag handle so each surface places it in its own markup. */
	children: (handle: ReactNode) => ReactNode;
}

export function ReorderableItem({
	id,
	as = "div",
	className,
	itemLabel,
	children,
}: ReorderableItemProps) {
	const context = useReorderable();
	const controls = useDragControls();
	const reduceMotion = useReducedMotion();

	return (
		<Reorder.Item
			value={id}
			as={as}
			// "position" only: the default also animates size, whose scale
			// correction distorts table cells on rows of unequal height.
			layout="position"
			dragListener={false}
			dragControls={controls}
			// relative, or the drag z-index has nothing to apply to and the row
			// slides under its neighbours.
			className={cn("relative", className)}
			transition={reduceMotion ? { duration: 0 } : undefined}
			onDragEnd={() => context.commit(context.ids)}
		>
			{children(
				<ReorderHandle id={id} itemLabel={itemLabel} controls={controls} />,
			)}
		</Reorder.Item>
	);
}

function ReorderHandle({
	id,
	itemLabel,
	controls,
}: {
	id: string;
	itemLabel: string;
	controls: ReturnType<typeof useDragControls>;
}) {
	const { ids, onReorder, commit, disabled, instructionsId, announce } =
		useReorderable();
	const index = ids.indexOf(id);
	const buttonRef = useRef<HTMLButtonElement>(null);

	function move(delta: number) {
		const target = index + delta;
		if (disabled || index === -1 || target < 0 || target >= ids.length) {
			return;
		}
		const next = [...ids];
		next.splice(target, 0, ...next.splice(index, 1));
		onReorder(next);
		commit(next);
		// Reordering moves this row's DOM node and focus falls to the body, so a
		// keyboard user could otherwise only ever move an item one slot. Looked up
		// from the document rather than through the ref, and deferred a frame,
		// because motion re-parents the row after React commits and the captured
		// node can be detached by then.
		requestAnimationFrame(() => {
			const handle = document.querySelector<HTMLButtonElement>(
				`[data-reorder-handle="${CSS.escape(id)}"]`,
			);
			handle?.focus();
		});
		announce(`${itemLabel} moved to position ${target + 1} of ${ids.length}.`);
	}

	return (
		<button
			ref={buttonRef}
			type="button"
			data-reorder-handle={id}
			// aria-disabled, not the disabled attribute: disabling the focused
			// handle mid-save would blur it to <body> and strand a keyboard user
			// mid-sequence. The handlers below already guard on `disabled`.
			aria-disabled={disabled}
			aria-label={`Reorder ${itemLabel}: position ${index + 1} of ${ids.length}`}
			aria-describedby={instructionsId}
			// No preventDefault — it would stop the button taking focus, which is
			// the whole keyboard entry point.
			onPointerDown={(event: ReactPointerEvent) => {
				// Primary button only, mirroring the filter motion applies on its
				// own dragListener path: a right-click must open the context menu,
				// not start a drag session.
				if (!disabled && event.button === 0) {
					controls.start(event);
				}
			}}
			onKeyDown={(event) => {
				if (event.key === "ArrowUp") {
					event.preventDefault();
					move(-1);
				} else if (event.key === "ArrowDown") {
					event.preventDefault();
					move(1);
				}
			}}
			className={cn(
				"flex h-7 w-6 shrink-0 items-center justify-center rounded text-muted-foreground",
				// touch-none, or a drag on touch fights page scrolling.
				"touch-none select-none outline-none",
				"focus-visible:ring-[3px] focus-visible:ring-ring/50",
				disabled
					? "cursor-default opacity-30"
					: "cursor-grab hover:text-foreground active:cursor-grabbing",
			)}
		>
			<GripVertical className="h-4 w-4" aria-hidden />
		</button>
	);
}
