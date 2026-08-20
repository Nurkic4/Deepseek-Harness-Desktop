# DSH network and sandbox notes

This guidance is intentionally isolated from `SKILL.md` because it can vary by environment and may become stale. Prefer the defaults in your environment when in doubt.

## Why am I asked to approve every image generation call?
Image generation uses the OpenAI Image API, so the CLI needs outbound network access. In DSH, the active permission preset and sandbox policy may require confirmation before networked commands run.

## How do I reduce repeated approval prompts (network)?
If you trust the repository and want fewer prompts, select the appropriate DSH access mode for the session. Keep `workspace-write` for ordinary work and use broader access only when the task requires it.

## Safety note
Use caution: enabling network and disabling approvals reduces friction but increases risk if you run untrusted code or work in an untrusted repository.
