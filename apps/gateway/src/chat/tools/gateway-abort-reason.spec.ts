import { describe, expect, it } from "vitest";

import {
	CLIENT_DISCONNECT_REASON,
	ClientDisconnectError,
	isGatewayAbortReason,
	isSelfInitiatedClientDisconnect,
} from "./gateway-abort-reason.js";

describe("gateway-abort-reason", () => {
	describe("CLIENT_DISCONNECT_REASON", () => {
		it("is an Error instance with the disconnect type tag", () => {
			// Error subclass keeps `instanceof Error` true at every catch site
			// and lets undici's internal `.stack` annotation succeed (a frozen
			// plain object reason produced "Cannot define property stack"
			// TypeErrors that polluted logs as upstream_error).
			expect(CLIENT_DISCONNECT_REASON).toBeInstanceOf(Error);
			expect(CLIENT_DISCONNECT_REASON).toBeInstanceOf(ClientDisconnectError);
			expect(CLIENT_DISCONNECT_REASON.type).toBe("client_disconnect");
			expect(Object.isExtensible(CLIENT_DISCONNECT_REASON)).toBe(true);
		});
	});

	describe("isGatewayAbortReason", () => {
		it("recognizes the canonical reason instance", () => {
			expect(isGatewayAbortReason(CLIENT_DISCONNECT_REASON)).toBe(true);
		});

		it("recognizes a structurally equivalent object", () => {
			expect(isGatewayAbortReason({ type: "client_disconnect" })).toBe(true);
		});

		it("rejects unrelated values", () => {
			expect(isGatewayAbortReason(null)).toBe(false);
			expect(isGatewayAbortReason(undefined)).toBe(false);
			expect(isGatewayAbortReason("client_disconnect")).toBe(false);
			expect(isGatewayAbortReason({ type: "timeout" })).toBe(false);
			expect(isGatewayAbortReason(new Error("boom"))).toBe(false);
		});
	});

	describe("isSelfInitiatedClientDisconnect", () => {
		it("returns true when the error IS the abort reason (ReadableStream path)", () => {
			// Both fetch() and ReadableStream.read() reject with the abort
			// reason itself rather than wrapping it. Recognize that shape.
			const controller = new AbortController();
			controller.abort(CLIENT_DISCONNECT_REASON);
			expect(
				isSelfInitiatedClientDisconnect(
					CLIENT_DISCONNECT_REASON,
					controller.signal,
				),
			).toBe(true);
		});

		it("returns true for an AbortError when the signal reason matches", () => {
			const controller = new AbortController();
			controller.abort(CLIENT_DISCONNECT_REASON);
			const err = new Error("The operation was aborted.");
			err.name = "AbortError";
			expect(isSelfInitiatedClientDisconnect(err, controller.signal)).toBe(
				true,
			);
		});

		it("returns false for an AbortError when the signal reason is unrelated", () => {
			const controller = new AbortController();
			controller.abort(new Error("upstream socket closed"));
			const err = new Error("The operation was aborted.");
			err.name = "AbortError";
			expect(isSelfInitiatedClientDisconnect(err, controller.signal)).toBe(
				false,
			);
		});

		it("returns false for a generic streaming error on a non-aborted signal", () => {
			const controller = new AbortController();
			const err = new TypeError("terminated");
			expect(isSelfInitiatedClientDisconnect(err, controller.signal)).toBe(
				false,
			);
		});

		it("returns false for a generic upstream JSON error even after abort", () => {
			// A late upstream-shaped error caught after we aborted ourselves
			// should still be treated as self-initiated only when the error is
			// our reason or a labeled AbortError. A SyntaxError mid-parse is
			// real upstream noise.
			const controller = new AbortController();
			controller.abort(CLIENT_DISCONNECT_REASON);
			const err = new SyntaxError("Unexpected end of JSON input");
			expect(isSelfInitiatedClientDisconnect(err, controller.signal)).toBe(
				false,
			);
		});
	});
});
