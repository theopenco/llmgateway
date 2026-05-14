# Provider Compliance & Trust Documentation

## Overview

Add compliance and trust documentation to each LLM provider definition in the models package. This data is hardcoded in `providers.ts`, synced to the DB via the existing worker, and displayed on the `/providers/<id>` page.

## Data Model

### TypeScript Interface

```typescript
type Certification =
  | "gdpr"
  | "soc2-type1"
  | "soc2-type2"
  | "iso27001"
  | "hipaa"
  | "ccpa"
  | "fedramp"
  | "pci-dss";

interface ProviderCompliance {
  termsUrl?: string | null;
  privacyPolicyUrl?: string | null;
  certifications?: Certification[];
  dataPolicy?: string | null;
  additionalLinks?: { label: string; url: string }[];
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `termsUrl` | `string \| null` | Link to terms & conditions |
| `privacyPolicyUrl` | `string \| null` | Link to privacy policy |
| `certifications` | `Certification[]` | Array of compliance certifications the provider holds |
| `dataPolicy` | `string \| null` | Free-text description of prompt logging/storage policy |
| `additionalLinks` | `{ label, url }[]` | Extra compliance-related links (DPA, data protection docs, etc.) |

### Certification Enum Values

- `gdpr` - EU General Data Protection Regulation
- `soc2-type1` - SOC 2 Type I
- `soc2-type2` - SOC 2 Type II
- `iso27001` - ISO/IEC 27001
- `hipaa` - Health Insurance Portability and Accountability Act
- `ccpa` - California Consumer Privacy Act
- `fedramp` - Federal Risk and Authorization Management Program
- `pci-dss` - Payment Card Industry Data Security Standard

## Database Schema Changes

Add columns to the existing `provider` table in `packages/db/src/schema.ts`:

```typescript
termsUrl: text(),
privacyPolicyUrl: text(),
certifications: text().$type<string[]>().array(),
dataPolicy: text(),
additionalLinks: jsonb().$type<{ label: string; url: string }[]>(),
```

## Sync Logic

Extend `apps/worker/src/services/sync-models.ts` to include the new fields in both the insert values and the onConflictDoUpdate set.

## API Changes

Extend the `/internal/providers` response schema in `apps/api/src/routes/internal-models.ts` to include the new compliance fields.

## UI Changes

### `/providers/[id]` page

Add a "Trust & Compliance" section between the hero and the models grid:

1. **Certification badges** - Colored pill/badge components for each certification
2. **Links section** - Terms, Privacy Policy, and additional links as clickable items
3. **Data Policy** - Text block describing prompt logging/storage behavior

The section only renders if at least one compliance field is populated.

## Data Population

All ~40 providers will have their compliance data researched and populated. For providers where information is not publicly available, fields will be left as `undefined`.

## Files to Modify

1. `packages/models/src/providers.ts` - Add `Certification` type, `ProviderCompliance` interface, `compliance` field to `ProviderDefinition`, populate data for all providers
2. `packages/db/src/schema.ts` - Add columns to `provider` table
3. `apps/worker/src/services/sync-models.ts` - Extend sync logic
4. `apps/api/src/routes/internal-models.ts` - Extend API response
5. `apps/ui/src/app/providers/[id]/page.tsx` - Add compliance section
6. `apps/ui/src/components/providers/` - New `compliance-section.tsx` component
