You are inspecting this codebase for silent fallbacks — code that swallows a failure instead of failing loudly.

The rule: get the happy path right and fail loudly on the unhappy path. A missing required value, an unrecognized case, or a failed operation must surface — throw, propagate, or exit non-zero. It must never be papered over with a default, a swallow-and-continue, or placeholder output.

Inspect every source file in the project (skip vendored/generated code and lockfiles). Flag:

- **A default masking a missing required value** — `?? x`, `|| x`, destructuring defaults — where absence is not a valid state but an error the default now hides.
- **Swallow-and-continue error handling** — a catch that substitutes a value, logs-and-continues, or no-ops where the failure should propagate. (A catch that translates and rethrows with context, or handles one specific expected case, is fine.)
- **Non-exhaustive dispatch over external input** — switch/if-chains over parsed JSON, CLI args, API responses, or event/message types whose unknown case is silently ignored, passed through, or coerced instead of thrown with the unhandled value.
- **Stubbed unimplemented paths** — a not-yet-supported option or branch returning a plausible default or no-op instead of throwing.
- **Placeholder output substituted for a failed operation** — fabricated or degraded values presented as if the operation succeeded.

The judgment that matters (a linter cannot make it; you must): a syntactically identical `?? default` can be a designed default in one place and a bug-hiding fallback in another. `title ?? "Untitled"` where records legitimately have no title is correct code — do not flag it. `config.url ?? "http://localhost:3000"` where the config is required hides a deployment error — flag it. Decide from context: comments, names, how the value is used downstream, whether the absent case can legitimately occur.

One carve-out: read-only status/diagnostic surfaces may degrade gracefully on failure — but must visibly show "unavailable", never fabricate a value.

For each finding report: `file:line`, the offending code, why the masked condition is a real failure, and what failing loudly would look like instead. Rank findings by confidence; if you cannot tell whether absence is a valid state, say so explicitly and rank it low. If there are no findings, say so explicitly.
