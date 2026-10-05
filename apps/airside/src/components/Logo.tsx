import { cn } from "@/lib/utils";

import { AirsideLogo } from "@llmgateway/shared/product-logos";

export function Logo({ className }: { className?: string }) {
	return <AirsideLogo className={cn("size-7", className)} />;
}
