# OCR Runtime

Vega Labs uses OCR for visual and document evidence extraction.

OCR means Optical Character Recognition and visual document understanding. It is not the chat runtime and it does not replace repository reasoning tools.

## Local Routes

- Chat/reasoning: `/bus/v1/responses`
- Gateway health: `/bus/health`
- OCR health: `/bus/v1/ocr/health`
- OCR models: `/bus/v1/ocr/models`
- OCR extract: `/bus/v1/ocr/extract`
- OCR image: `/bus/v1/ocr/image`
- OCR PDF: `/bus/v1/ocr/pdf`
- OCR table: `/bus/v1/ocr/table`

## Active Tools

- `ocr_health`
- `inspect_image_with_ocr`
- `inspect_pdf_with_ocr`
- `extract_repo_visual_evidence`
- `extract_skill_evidence_from_pdf`
- `inspect_model_zoo`

## Rules

- Use OCR for screenshots, PDFs, diagrams, graphs, tables, and visual SKILL evidence.
- Keep OCR outputs internal/pending until reviewed.
- Do not auto-publish, create houses, open PRs, merge, deploy, or mutate other repositories from OCR output.
- Keep model-zoo as the source of truth for OCR/VLM model metadata.
- If OCR or `mlx-vision` is offline, report the failed dependency instead of pretending extraction happened.

## Migration Note

Previous local work accidentally used ORC naming. Active Vega Labs routes and docs now use OCR for visual/document extraction and `/v1/responses` for local chat.
