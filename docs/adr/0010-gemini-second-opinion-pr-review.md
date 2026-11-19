# ADR 0010: Gemini as second-opinion pull request reviewer

- Status: Accepted
- Date: 2026-11-19
- Authors: apefrei

## Context

Most code in this repository is written by an AI coding agent (Claude). A reviewer from a different model family
catches a different class of mistakes – hallucinated APIs, overlooked edge cases, blind spots shared by author and
reviewer of the same model. The owner has a Google AI Studio API key and wants Gemini to review every pull request.

## Decision

Add a GitHub Actions workflow (`.github/workflows/gemini-review.yml`) that sends each pull request's diff, together
with the PR title, description and the project rules, to the Gemini API and posts the result as a single PR comment,
updated on every push. The review is advisory and never a required check.

Details:

- Script: `.github/scripts/gemini-review.mts`, Node 26, standard library only (no third-party action or package).
- Model: repository variable `GEMINI_MODEL`, default `gemini-pro-latest`; optional `GEMINI_FALLBACK_MODEL`. If a model
  does not exist, the job fails and lists the available models.
- Overload (HTTP 429/5xx): up to 5 attempts per model with back-off (Retry-After honoured), then the fallback model.
  If all are unavailable, the job ends with a warning (not a failure) and a short note in the PR comment; an existing
  review is not overwritten. Configuration errors (invalid key, unknown model) fail the job.
- Secret: `GEMINI_API_KEY` (repository secret). Sent in the `x-goog-api-key` header, never in the URL. Without the
  secret, the job skips with a notice.
- Scope: pull requests from this repository only; forks and Dependabot are skipped (no secrets available there).
- Input: diff from merge base to head, lock files and snapshots excluded, capped at 400,000 characters (marked as
  truncated in the comment).
- Review criteria from `CLAUDE.md` and `.claude/rules/` (security, policies, code quality, stack), read from the PR's
  base commit so a PR cannot change the rules it is reviewed against; findings must cite
  `path:line`, uncertain points must be marked, severities 🛑 / ⚠️ / 💡 match `policies.md`.
- Prompt injection: PR text and diff are declared untrusted in the system instruction. The model has no tools; its only
  effect is the text of one comment, written with a token limited to `contents: read` and `pull-requests: write`.
- One comment per PR (hidden marker), updated on each push; concurrent runs for the same PR are cancelled.
- Content filter stops and answers that hit the output limit without text end as a warning with a note, like
  overloads. A note is shown above the last review, which stays visible.
- Write permission (`pull-requests: write`) only for the review job; the test job runs read-only.
- Overall time budget of 12 minutes inside the 15-minute job timeout; all HTTP calls have timeouts.
- Unit tests with Node's built-in test runner (`.github/scripts/gemini-review.test.mts`, job `script-tests`).

## Rationale

- A different model family adds independent coverage at low cost.
- Keeping the script in the repository (instead of a marketplace action) means no third-party code receives the API
  key or the GitHub token, and the behaviour is reviewable.
- An updated single comment avoids notification noise on frequent pushes.

## Rejected alternatives

- **The initial inline proposal** (Python inside YAML): API key in the URL query string, outdated model and action
  versions, a new comment on every push, no handling of blocked or truncated responses, no project rules as context.
- **Marketplace AI review actions:** third-party code with access to secrets and write permissions.
- **Gemini as a required check:** model output is not deterministic; a human decides.
- **Inline review comments per line:** more noise and more complex API handling; may be added later.

## Consequences

- Positive: second opinion on every PR before the owner reviews.
- Negative: ⚠️ third-party AI provider. The repository is public and MIT-licensed, so the code itself is not
  confidential, but PR descriptions are sent too: never put secrets or personal data into PR descriptions. On the
  free tier of Google AI Studio, Google may use submitted content to improve its products; a paid tier avoids that.
- Negative: API costs per push; mitigated by cancelling superseded runs and excluding lock files.
- Follow-up: the owner creates the secret `GEMINI_API_KEY` and, optionally, the variable `GEMINI_MODEL`.

## References

- `.claude/rules/policies.md` (severities, high-risk areas)
- Gemini API `generateContent` and `models.list` (Google AI for Developers)
