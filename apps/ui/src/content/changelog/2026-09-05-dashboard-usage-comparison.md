---
id: "94"
slug: "dashboard-usage-comparison"
date: "2026-09-05"
title: "Compare Usage Across Periods"
summary: "The dashboard usage chart now overlays a comparison period, whether the previous period, a chosen week or month, or an exact custom range, and switches between a total view and a token-cost breakdown. Bars are grouped and stacked with an explicit legend, and rankings gain a hover-isolating legend and an all-time top apps panel."
image:
  src: "/changelog/dashboard-usage-comparison.png"
  alt: "Two overlapping glowing bar charts, one solid and one translucent, with a calendar tile on a circuit board chip, surrounded by clocks and coins"
  width: 1536
  height: 1024
---

"Did spend go up because we swapped models, or because traffic grew?" used to mean exporting two CSVs and lining them up by hand. The **usage chart** on the dashboard now answers it in place: pick a comparison period and it renders as a ghost series behind the current one, with tooltips that show both values for every bar.

## Overlay a Comparison

The **Compare** control offers the previous period of the same length, a week, a month, or an exact custom range. Weekly and monthly comparisons can start on any date you choose; they keep their duration and always end before the active range begins, so the two periods never overlap. Custom ranges are picked by exact day on desktop and mobile, replacing the old month-only selector.

## Total or Token Cost

Switch the chart between a **total** view and a **token-cost breakdown**, so a comparison can show either the headline number or where the money went. Both views carry the comparison overlay.

## Clearer Charts

The main usage area chart is now grouped and stacked bars with an explicit legend, so per-bucket values read directly instead of being inferred from a slope. On the rankings page, hovering a legend entry isolates that series, and a new panel lists the top coding apps of all time.

---

**[Dashboard guide →](https://docs.llmgateway.io/learn/dashboard)** | **[Open your dashboard →](https://llmgateway.io/dashboard)**
