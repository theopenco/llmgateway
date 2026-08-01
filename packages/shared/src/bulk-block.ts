// Limits for the admin "bulk block organizations" action. Shared so the admin
// dashboard gates on the same numbers the API enforces — the API is the only
// thing that actually protects the data, and a UI copy that drifts from it
// would show or hide the action for filters the server disagrees about.

// A one or two character filter matches far too much to be a deliberate
// selection, so require something specific enough to identify a set of orgs.
export const MIN_BULK_BLOCK_SEARCH_LENGTH = 3;

// Hard ceiling on a single bulk block. A filter matching more than this is
// treated as too broad to be an intentional selection and is rejected outright
// rather than partially applied.
export const MAX_BULK_BLOCK_ORGANIZATIONS = 500;
