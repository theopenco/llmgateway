---
name: legal-pages
description: Edit LLM Gateway legal documents — Terms of Use, Privacy Policy, sub-processors, and product-specific supplemental terms such as DevPass. Use when changing any legal page, company details, contact address, data retention wording, or plan rules stated in legal text.
---

# Legal pages

The base Terms of Use and Privacy Policy live in `apps/ui/src/content/legal/`.
Each product layers supplemental terms and policies on top — DevPass at
`apps/code/src/app/legal/terms/page.tsx` and
`apps/code/src/app/legal/privacy/page.tsx`.

Apply every change consistently across the base and supplemental documents: a
fact stated only in the base terms (company details, contact address, retention
behavior, plan rules) leaves the supplemental version contradictory. Search all
of `apps/*/src/**/legal` before calling the edit complete.
