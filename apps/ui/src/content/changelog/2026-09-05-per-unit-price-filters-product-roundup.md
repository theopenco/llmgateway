---
id: "97"
slug: "per-unit-price-filters-product-roundup"
date: "2026-09-05"
title: "Per-Unit Price Filters, Seedream References & More"
summary: "The models directory filters and sorts image, video, and speech models by their real unit prices and shows retirement status as chips; model pages sort providers by price, speed, or context; Seedream 5.0 Pro accepts up to 10 reference images; DevPass shows exact renewal and reset times; and Enterprise licenses warn 90 days before expiry."
image:
  src: "/changelog/per-unit-price-filters-product-roundup.png"
  alt: "A glowing price tag passing through a filter funnel on a circuit board chip, surrounded by slider controls, picture frames, a calendar clock, and a shield badge"
  width: 1536
  height: 1024
---

A roundup of smaller changes from the last two weeks, mostly about finding the right model faster and seeing exact numbers where you used to get approximations.

## Price Per Unit in the Models Directory

Image, video, and speech models are not priced per token, so the directory's token-price filter used to show them as `$0.00` or push them to the bottom. A new **Price per unit** filter switches the price column to what those models actually charge, with discounts applied:

| Filter | Unit           |
| ------ | -------------- |
| Image  | $ per image    |
| Video  | $ per second   |
| Speech | $ per 1K chars |

Sorting follows the selected unit, free models sort first, models without a price sort last in both directions, and the choice persists in the URL as `priceUnit`.

## Status Chips

The single "show deactivated" toggle is gone. Three chips separate **active**, **scheduled** (a deactivation date within 90 days), and **deactivated** models, derived from the timestamps the catalogue already carries, and the table view now shows the same status badge the grid had.

## Sort Providers on a Model Page

Each model page gets a sort control above its provider cards: Featured, Cheapest input, Cheapest output, Fastest, and Most context. Fastest uses the same 24-hour throughput as the Provider Performance section and shows a `tok/s` chip on each card while active. The sort is written to `?sort=` so a view can be shared, and every provider name now links to its provider page.

## Seedream 5.0 Pro Reference Images

`bytedance/seedream-5-0-pro` accepts reference images in image-generation requests: pass one or more OpenAI-style image parts and the gateway maps them to ByteDance's reference field, up to 10 images, at 1K or 2K output with 2K as the default.

## Exact Plan Times on DevPass

Renewal, cancellation, scheduled tier changes, and weekly allowance resets are shown to the minute in your selected timezone, including inside the cancellation feedback and the weekly cap dialog, instead of as bare dates.

## Enterprise License Expiry Warnings

The licensed organization's dashboard warns 90 days before an Enterprise license expires, turning from orange to red at 30 days. White-label license warnings appear in the admin dashboard only, and grace-period notices follow the same placement.

---

**[Models directory →](https://llmgateway.io/models)** | **[Image generation docs →](https://docs.llmgateway.io/features/image-generation)**
