import { createSharedPathnamesNavigation } from "next-intl/navigation";

import { locales } from "./config";

// Navigation utilities for URL-based routing (if needed in the future)
// Currently using cookie-based routing, so these utilities may not be used
const navigation = createSharedPathnamesNavigation({ locales });

// Export as namespace to avoid TypeScript inference issues
export { navigation };
