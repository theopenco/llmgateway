import { HTTPException } from "hono/http-exception";

/** A 5xx for a known, non-bug outcome; the global handler logs it at warn. */
export class ExpectedHTTPException extends HTTPException {}
