# Deprecated ORC Runtime Note

This document is retained only as a historical correction note.

Vega Labs does **not** use ORC as an active runtime. The earlier ORC wording was a mistaken implementation path caused by acronym confusion. ORC must not be treated as the Vega Labs chat runtime, tool runtime, model route, or visual evidence route unless it is explicitly revived in a future architecture decision.

## Active Runtime

- Chat and reasoning use `/bus/v1/responses`.
- Runtime health uses `/bus/health`.
- Model discovery uses `/bus/v1/models`.
- OCR/document evidence uses `/bus/v1/ocr/*`.

## Active OCR Routes

- OCR health: `/bus/v1/ocr/health`
- OCR models: `/bus/v1/ocr/models`
- OCR extract: `/bus/v1/ocr/extract`
- OCR image: `/bus/v1/ocr/image`
- OCR PDF: `/bus/v1/ocr/pdf`
- OCR table: `/bus/v1/ocr/table`

## Rules

- OCR means Optical Character Recognition and visual document understanding.
- OCR is not the chat runtime and does not replace repository reasoning tools.
- OCR output is evidence only and remains `internal` / `pending` until reviewed.
- OCR-derived evidence must not auto-publish, create houses, open PRs, merge, deploy, or mutate external repositories.
- Any old `/bus/v1/orc/*` or `/v1/orc/*` path is deprecated and must not be used by active Vega Labs code.

