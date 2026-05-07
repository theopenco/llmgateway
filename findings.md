# Content Filter Findings

## Script

- Script: `packages/scripts/src/analyze-content-filter.ts`
- Package command: `pnpm --filter @llmgateway/scripts analyze-content-filter --file /abs/path/to/file.csv`

## CSV Format

Required CSV columns:

```text
id,requested_model,used_model,cost,prompt_tokens,cached_tokens,completion_tokens,unified_finish_reason,image_output_tokens,internal_content_filter,gateway_content_filter_response
```

Notes:

- `gateway_content_filter_response` contains a JSON moderation payload or an array of moderation payloads.
- The analyzer reads `results[].flagged` and `results[].category_scores`.
- Ground truth is `unified_finish_reason === content_filter`.

## contentfiltered.csv

File:

```text
/Users/steebchen/projects/llmgateway/llmgateway/contentfiltered.csv
```

Dataset totals:

- Rows: `100`
- Content-filter rows: `98`
- Rows with gateway moderation payloads: `100`
- Content-filter rows without gateway payloads: `0`

Current and candidate rules:

- `any category score > 0.8`
  - TP `47`
  - FP `2`
  - FN `51`
  - TN `0`
  - Precision `95.92%`
  - Recall `47.96%`
  - F1 `63.95%`
- `any moderation result flagged === true`
  - TP `84`
  - FP `2`
  - FN `14`
  - TN `0`
  - Precision `97.67%`
  - Recall `85.71%`
  - F1 `91.30%`
- `flagged === true OR any category score > 0.8`
  - TP `84`
  - FP `2`
  - FN `14`
  - TN `0`
  - Precision `97.67%`
  - Recall `85.71%`
  - F1 `91.30%`
- Best global threshold with `FP <= 0`
  - Rule: `any category score > 0.9203`
  - TP `15`
  - FP `0`
  - FN `83`
  - TN `2`
  - Precision `100.00%`
  - Recall `15.31%`
  - F1 `26.55%`
- Per-category thresholds with `FP <= 0`
  - TP `61`
  - FP `0`
  - FN `37`
  - TN `2`
  - Precision `100.00%`
  - Recall `62.24%`
  - F1 `76.73%`

Current rule diagnosis:

- Current false negatives with payloads: `51`
- Current false positives with payloads: `2`
- Current false negatives where OpenAI already said `flagged=true`: `37`
- Recommended global threshold under FP budget `0`: `0.9203`

Per-category zero-FP thresholds:

- `self-harm/instructions > 0.0002` catches `44/98` content-filter rows at `0` FP
- `self-harm/intent > 0.0002` catches `42/98` content-filter rows at `0` FP
- `sexual/minors > 0.0013` catches `38/98` content-filter rows at `0` FP
- `self-harm > 0.0047` catches `35/98` content-filter rows at `0` FP
- `hate > 0` catches `29/98` content-filter rows at `0` FP
- `hate/threatening > 0` catches `25/98` content-filter rows at `0` FP
- `illicit/violent > 0` catches `24/98` content-filter rows at `0` FP
- `illicit > 0` catches `23/98` content-filter rows at `0` FP
- `harassment > 0.0092` catches `21/98` content-filter rows at `0` FP
- `violence/graphic > 0.0162` catches `19/98` content-filter rows at `0` FP
- `harassment/threatening > 0.006` catches `18/98` content-filter rows at `0` FP
- `sexual > 0.9203` catches `15/98` content-filter rows at `0` FP

Example missed row:

- Row id: `lO2q3Xn1c7904F442tV9`
- Requested model: `gemini-3-pro-image-preview`
- Finish reason: `content_filter`
- `flagged=true`
- Highest category score: `sexual=0.7767`
- Top categories:
  - `sexual=0.7767`
  - `sexual/minors=0.4615`
  - `violence=0.0102`
- It is missed by the current rule because `0.7767 < 0.8`.

Top current false positives:

- `8MUzxpJw7e0MeBencofo`
  - model `gemini-3.1-flash-image-preview`
  - finish `upstream_error`
  - max score `0.8347`
  - `flagged=true`
  - categories `violence=0.8347`, `sexual=0.3811`, `violence/graphic=0.0162`
- `9FVxdUAxKOBYbnAHw8mn`
  - model `gemini-3-pro-image-preview`
  - finish `completed`
  - max score `0.9203`
  - `flagged=true`
  - categories `sexual=0.9203`, `sexual/minors=0.0013`, `harassment=0.0009`

## contentfilter2.csv

File:

```text
/Users/steebchen/projects/llmgateway/llmgateway/contentfilter2.csv
```

Dataset totals:

- Rows: `800`
- Content-filter rows: `639`
- Rows with gateway moderation payloads: `800`
- Content-filter rows without gateway payloads: `0`

Current and candidate rules:

- `any category score > 0.8`
  - TP `324`
  - FP `161`
  - FN `315`
  - TN `0`
  - Precision `66.80%`
  - Recall `50.70%`
  - F1 `57.65%`
- `any moderation result flagged === true`
  - TP `547`
  - FP `161`
  - FN `92`
  - TN `0`
  - Precision `77.26%`
  - Recall `85.60%`
  - F1 `81.22%`
- `flagged === true OR any category score > 0.8`
  - TP `547`
  - FP `161`
  - FN `92`
  - TN `0`
  - Precision `77.26%`
  - Recall `85.60%`
  - F1 `81.22%`
- Best global threshold with `FP <= 0`
  - Rule: `any category score > 0.9919`
  - TP `16`
  - FP `0`
  - FN `623`
  - TN `161`
  - Precision `100.00%`
  - Recall `2.50%`
  - F1 `4.89%`
- Per-category thresholds with `FP <= 0`
  - TP `27`
  - FP `0`
  - FN `612`
  - TN `161`
  - Precision `100.00%`
  - Recall `4.23%`
  - F1 `8.11%`

Current rule diagnosis:

- Current false negatives with payloads: `315`
- Current false positives with payloads: `161`
- Current false negatives where OpenAI already said `flagged=true`: `223`
- Recommended global threshold under FP budget `0`: `0.9919`

Per-category zero-FP thresholds:

- `sexual > 0.9919` catches `16/639` content-filter rows at `0` FP
- `sexual/minors > 0.6992` catches `4/639` content-filter rows at `0` FP
- `self-harm/intent > 0.0084` catches `2/639` content-filter rows at `0` FP
- `harassment > 0.1966` catches `2/639` content-filter rows at `0` FP
- `violence > 0.8669` catches `2/639` content-filter rows at `0` FP
- `self-harm/instructions > 0.0005` catches `1/639` content-filter rows at `0` FP
- `hate > 0.0443` catches `1/639` content-filter rows at `0` FP
- `violence/graphic > 0.3341` catches `1/639` content-filter rows at `0` FP

Completed rows:

- `completed` rows: `158`
- `completed` rows with `flagged=true`: `158`

Model / finish / flagged breakdown:

- `gemini-3-pro-image-preview | content_filter | true`: `522`
- `gemini-3-pro-image-preview | completed | true`: `144`
- `gemini-3-pro-image-preview | content_filter | false`: `75`
- `gemini-3.1-flash-image-preview | content_filter | true`: `25`
- `gemini-3.1-flash-image-preview | content_filter | false`: `17`
- `gemini-3.1-flash-image-preview | completed | true`: `14`
- `gemini-3.1-flash-image-preview | upstream_error | true`: `2`
- `gemini-3-pro-image-preview | upstream_error | true`: `1`

Top current false positives:

- `nM6uqK1RrkdfmMOja54h`
  - model `gemini-3-pro-image-preview`
  - finish `completed`
  - max score `0.9241`
  - `flagged=true`
  - categories `sexual=0.9241`, `violence=0.6212`, `violence/graphic=0.0061`
- `h7CgfhfXpag1nFQOtnff`
  - model `gemini-3-pro-image-preview`
  - finish `completed`
  - max score `0.9242`
  - `flagged=true`
  - categories `sexual=0.9242`, `violence=0.6213`, `violence/graphic=0.0061`
- `8P51KBHF1OGS1ydCY8zQ`
  - model `gemini-3-pro-image-preview`
  - finish `completed`
  - max score `0.9245`
  - `flagged=true`
  - categories `sexual=0.9245`, `violence=0.621`, `violence/graphic=0.0061`

## Blocking Rules Measured on contentfilter2.csv

Exact rules measured on the `contentfilter2.csv` dataset:

- `flagged === true && sexual > 0.9919`
  - TP `16`
  - FP `0`
  - FN `623`
  - TN `161`
  - Precision `100.00%`
  - Recall `2.50%`
  - False-positive rate `0.00%`
- `flagged === true && (sexual > 0.9919 || sexual/minors > 0.6992 || violence > 0.8669)`
  - TP `22`
  - FP `1`
  - FN `617`
  - TN `160`
  - Precision `95.65%`
  - Recall `3.44%`
  - False-positive rate `0.62%`

## Reroute Rules Measured on contentfilter2.csv

Rules measured against the same `800` rows, scoped to:

- `gemini-3-pro-image-preview`
- `gemini-3.1-flash-image-preview`

Candidate reroute rules:

- `sexual/minors > 0.0001796149154900369`
  - TP `353`
  - FP `38`
  - FN `286`
  - TN `123`
  - Precision `90.28%`
  - Recall `55.24%`
  - False-positive rate `23.60%`
- `sexual/minors > 0.0001796149154900369 || hate > 0.00003740956047302422`
  - TP `391`
  - FP `46`
  - FN `248`
  - TN `115`
  - Precision `89.47%`
  - Recall `61.19%`
  - False-positive rate `28.57%`

Reference single-feature thresholds previously measured on `contentfilter2.csv`:

- `sexual/minors > 0.00023231625226312826`
  - TP `310`
  - FP `32`
  - Recall `48.51%`
  - False-positive rate `19.88%`
- `sexual/minors > 0.0001796149154900369`
  - TP `353`
  - FP `38`
  - Recall `55.24%`
  - False-positive rate `23.60%`
- `sexual/minors > 0.00012448433020883747`
  - TP `401`
  - FP `46`
  - Recall `62.75%`
  - False-positive rate `28.57%`
- `harassment > 0.0007530659782696593`
  - TP `259`
  - FP `32`
  - Recall `40.53%`
  - False-positive rate `19.88%`
- `harassment/threatening > 0.0007516926173678823`
  - TP `262`
  - FP `33`
  - Recall `41.00%`
  - False-positive rate `20.50%`
- `hate/threatening > 0.0000034808121961114687`
  - TP `241`
  - FP `30`
  - Recall `37.72%`
  - False-positive rate `18.63%`
