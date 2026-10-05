# OpenAI Responses API fixtures

Response bodies in the shape `POST /v1/responses` returns, used by the offline unit tests and the offline run of the
`LlmClient` contract suite. No API key existed when L-040 was written, so they were written by hand from the API
reference rather than captured from a live call; L-212 re-records them if a live run shows the shape has drifted.

They hold only synthetic prompts and answers, never reading text from any translation (ADR 0003).
