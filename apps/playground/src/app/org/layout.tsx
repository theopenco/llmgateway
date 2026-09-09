import type { Metadata } from "next";
import type { ReactNode } from "react";

// Org-scoped shared-chat views are member-only; keep them out of search.
export const metadata: Metadata = {
	robots: { index: false, follow: false },
};

export default function OrgLayout({ children }: { children: ReactNode }) {
	return children;
}
