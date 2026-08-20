# Bundled Skill Sources

This directory contains the Skill bundles selected for the customized DSH desktop build.

- GitHub skills, Build Web Apps skills, and Build Web Data Visualization skills were sourced from the OpenAI plugins cache versions `0.1.6`, `0.1.2`, and `0.1.21`. Their plugin manifests declare the MIT license. Codex-specific connector and browser instructions were adapted to DSH's local `git`, `gh`, `agent-browser`, terminal, and multimodal image capabilities.
- `css-protips` retains its upstream license and package metadata.
- `agent-browser`, `imagegen`, and `screenshot` retain their bundled files and upstream notices where present. Their instructions were adapted only where they referred to Codex-specific runtime behavior.
- `review-agent` was adapted from the locally installed system Skill as a read-only review workflow.

The runtime copy under `$DSH_HOME/bundled-skills` is managed by Deepseek-Harness-Desktop. User-authored skills belong under `$DSH_HOME/skills` and are not overwritten by this synchronization.
