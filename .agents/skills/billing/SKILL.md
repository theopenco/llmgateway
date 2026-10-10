---
name: billing
description: Organizations, plans, credits, and billing in LLM Gateway — org kinds, the Pro plan, DevPass and Chat entitlements, Stripe webhooks, end-user wallets, cost and token billing math, audit logs, and org-scoped emails and notifications. Use when changing apps/api/src/stripe.ts, subscription or credit logic, cost calculation, organization.kind or plan gating, DevPass status, audit_log actions, or any email or notification sent for an organization.
---

# Billing and organizations

## Money

- Do all money, credit, and usage-threshold math with `Decimal` from `decimal.js`; convert DB decimal strings with `new Decimal(value ?? 0)`.
- Token extraction (`apps/gateway/src/chat/tools/extract-token-usage.ts`) normalizes completion tokens to include reasoning; `calculateCosts` (`packages/actions/src/costs.ts`) bills the completion count and reports `reasoningTokens` as a detail. Verify a new reasoning provider's usage semantics live.

## Organization kinds and plans

- `organization.kind` (`default` / `devpass` / `chat`) is set at creation and never changes; DevPass and Chat signups get a separate organization (`apps/api/src/utils/personal-org.ts`). Joining on it for historical attribution is safe. `organization.plan` changes over time.
- The Pro plan exists only on `default` orgs. DevPass and Chat entitlements live in `devPlan` / `chatPlan` and their `*CreditsLimit` / `*StripeSubscriptionId` columns; `organization.stripeSubscriptionId` is reserved for a team org's Pro subscription.
- Every Stripe webhook that sets `plan: "pro"` or stamps `stripeSubscriptionId` first returns for non-default kinds, as `checkout.session.completed`, `customer.subscription.created`, and `invoice.payment_succeeded` in `apps/api/src/stripe.ts` do. A `devpass` or `chat` org with `plan: "pro"` is corrupt state; gate product behavior for those orgs on their own entitlement columns.
- End-user wallet organizations are regular PAYG `default` orgs. `withWalletCredits` affects only downstream credit gating, never kind- or plan-gated gateway logic.
- For "has this org ever paid for DevPass", use `hasBillingHistory` from `GET /dev-plans/status`; plan end clears every `devPlan*` column.

## Audit log, emails, notifications

- `audit_log` records actions owned by one organization. User-account events (email, password, profile) belong in a user-scoped store.
- Send org-scoped email only when the org owner's email is verified, via `isOrgOwnerEmailVerified` / `resolveVerifiedOrgRecipient` (`@llmgateway/db`). Only verification and password-reset emails reach unverified users.
- Prefix org-scoped notification event keys with the org id.
