import configuration from "../../content-collections.ts";
import { GetTypeByName } from "@content-collections/core";

export type Changelog = GetTypeByName<typeof configuration, "changelog">;
export declare const allChangelogs: Array<Changelog>;

export {};
