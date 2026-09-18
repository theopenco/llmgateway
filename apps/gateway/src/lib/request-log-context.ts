import { AsyncLocalStorage } from "node:async_hooks";

// Trusted internal forwards share their caller's state to avoid duplicate logs.
export const requestLogContext = new AsyncLocalStorage<{ logged: boolean }>();
