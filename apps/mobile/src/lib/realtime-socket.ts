import type { RealtimeSocket } from "@/lib/transcription-session";

export function connectRealtime(
	url: string,
	protocols: string[],
): RealtimeSocket {
	const socket = new WebSocket(url, protocols);
	const connection: RealtimeSocket = {
		get readyState() {
			return socket.readyState;
		},
		onopen: null,
		onmessage: null,
		onerror: null,
		onclose: null,
		send: (data) => socket.send(data),
		close: () => socket.close(),
	};
	socket.onopen = () => connection.onopen?.();
	socket.onmessage = ({ data }) => connection.onmessage?.({ data });
	socket.onerror = () => connection.onerror?.();
	socket.onclose = () => connection.onclose?.();
	return connection;
}
