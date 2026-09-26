import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	use,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { AppState } from "react-native";

import { callEntries, saveCall } from "@/api/calls";
import { mintVoiceSession } from "@/api/realtime";
import { createMicrophone } from "@/lib/microphone";
import { NativeRealtimePlayback } from "@/lib/realtime-playback";
import { connectRealtime } from "@/lib/realtime-socket";
import { VoiceSession } from "@/lib/voice-session";

import type { PendingCall } from "@/api/calls";
import type { VoiceSelection } from "@/api/realtime";
import type { SavedCall } from "@/lib/call-transcript";
import type { VoiceState } from "@/lib/voice-session";
import type { PropsWithChildren } from "react";

function useCalls(organizationId: string, projectId: string) {
	const queries = useQueryClient();
	const pendingKey = useMemo(
		() => ["pending-voice-call", organizationId],
		[organizationId],
	);
	const pending = useQuery<PendingCall | null>({
		queryKey: pendingKey,
		queryFn: () => null,
		initialData: null,
		enabled: false,
		gcTime: Infinity,
	});
	const [savedId, setSavedId] = useState<string>();
	const resumeIdRef = useRef<string | undefined>(undefined);
	const save = useMutation({
		mutationFn: saveCall,
		onSuccess: (id, value) => {
			if (queries.getQueryData(pendingKey) === value) {
				queries.setQueryData(pendingKey, null);
			}
			setSavedId(id);
			void queries.invalidateQueries({
				queryKey: ["get", "/playground/realtime-history"],
			});
			void queries.invalidateQueries({
				queryKey: ["get", "/playground/realtime-history/{id}"],
			});
		},
	});
	const onEndedRef = useRef<(state: VoiceState) => void>(() => undefined);
	onEndedRef.current = (state) => {
		if (!callEntries(state, Boolean(resumeIdRef.current)).length) {
			return;
		}
		const value: PendingCall = {
			organizationId,
			resumeId: resumeIdRef.current,
			state,
		};
		queries.setQueryData(pendingKey, value);
		save.mutate(value);
	};
	const session = useMemo(
		() =>
			new VoiceSession({
				microphone: (rate) =>
					createMicrophone(
						rate,
						"Allow microphone access in iOS Settings to make voice calls.",
						true,
					),
				playback: () => new NativeRealtimePlayback(),
				mint: (selection, signal) =>
					mintVoiceSession(projectId, selection, signal),
				connect: connectRealtime,
				onEnded: (state) => onEndedRef.current(state),
			}),
		[projectId],
	);
	const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
	useEffect(() => {
		const listener = AppState.addEventListener("change", (next) => {
			if (next === "background") {
				void session.end();
			}
		});
		return () => {
			listener.remove();
			void session.end();
		};
	}, [session]);
	return {
		session,
		state,
		pending: pending.data,
		savedId,
		saving: save.isPending,
		saveError: save.error,
		retrySave: () => {
			if (pending.data && !save.isPending) {
				save.mutate(pending.data);
			}
		},
		start: (selection: VoiceSelection, previous?: SavedCall) => {
			if (
				queries.getQueryData(pendingKey) ||
				save.isPending ||
				session.getSnapshot().status !== "idle"
			) {
				return;
			}
			resumeIdRef.current = previous?.id;
			setSavedId(undefined);
			save.reset();
			void session.start(
				selection,
				previous?.transcript.map((entry, index) => ({
					...entry,
					id: `seed-${index}`,
				})),
			);
		},
		reset: () => {
			if (queries.getQueryData(pendingKey) || state.status !== "idle") {
				return;
			}
			setSavedId(undefined);
			resumeIdRef.current = undefined;
			session.reset();
		},
	};
}
const CallsContext = createContext<ReturnType<typeof useCalls> | null>(null);

export function VoiceCallsProvider({
	organizationId,
	projectId,
	children,
}: PropsWithChildren<{ organizationId: string; projectId: string }>) {
	const calls = useCalls(organizationId, projectId);
	return <CallsContext value={calls}>{children}</CallsContext>;
}
export function useVoiceCalls() {
	const calls = use(CallsContext);
	if (!calls) {
		throw new Error("VoiceCallsProvider is missing.");
	}
	return calls;
}
