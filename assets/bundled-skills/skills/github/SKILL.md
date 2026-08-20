---
name: github
description: Triage and orient GitHub repository, pull request, and issue work with the local git checkout and GitHub CLI. Use when the user asks for general GitHub help, wants PR or issue summaries, or needs repository context before choosing a more specific GitHub workflow.
---

# GitHub

## Overview

Use this skill as the umbrella entrypoint for general GitHub work. It should decide whether the task stays in repository and pull-request triage or should be handed off to a more specific review, CI, or publish workflow.

- Use local `git` for checkout, branch, diff, and history inspection.
- Use authenticated GitHub CLI `gh` for repositories, issues, pull requests, comments, labels, reactions, and GitHub Actions.
- If the request is about the current branch, resolve the local repository and branch before acting.

Once the intent is clear, route to the specialist skill immediately and do not keep broad GitHub triage in scope longer than needed.

## Responsibilities

Handle these directly in this skill when the request does not need a narrower specialist workflow:

- repository orientation once the repo, PR, issue, or local checkout is identified
- recent PR or issue triage
- PR metadata summaries
- PR patch inspection
- PR comments, labels, and reactions
- issue lookup and summarization
- PR creation after a branch is already pushed

Prefer structured `gh --json` output for these flows. If the repository is not identifiable from the user request or local git context, ask for the repository instead of guessing.

## Routing Rules

1. Resolve the operating context first:
   - If the user provides a repository, PR number, issue number, or URL, use that.
   - If the request is about "this branch" or "the current PR", resolve local git context and use `gh pr view --json number,url` to discover the branch PR.
   - If the repository is still ambiguous after local inspection, ask for the repo identifier.
2. Classify the request before taking action:
   - `repo or PR triage`: summarize PRs, issues, patches, comments, labels, reactions, or repository state
   - `review follow-up`: unresolved review threads, requested changes, or inline review feedback
   - `CI debugging`: failing checks, Actions logs, or CI root-cause analysis
   - `publish changes`: create or switch branches, stage changes, commit, push, and open a draft PR
3. Route to the specialist skill as soon as the category is clear:
   - Review comments and requested changes: `../gh-address-comments/SKILL.md`
   - Failing GitHub Actions checks: `../gh-fix-ci/SKILL.md`
   - Commit, push, and open PR: `../yeet/SKILL.md`
4. Keep tool ownership consistent after routing:
   - local `git` for checkout state and diffs
   - authenticated `gh` for remote GitHub state and writes

## Default Workflow

1. Resolve repository and item scope.
2. Gather structured PR or issue context through `gh`.
3. Decide whether the task stays in general triage or needs a specialist skill.
4. Route immediately when the work becomes review follow-up, CI debugging, or publish workflow.
5. End with a clear summary of what was inspected, what changed, and what remains.

## Output Expectations

- For triage requests, return a concise summary of the repository, PR, or issue state and the next likely action.
- For mixed requests, tell the user which specialist path you are taking and why.
- For remote write actions, restate the exact PR, issue, label, or reaction target before applying the change.
- Confirm `gh auth status` before the first remote operation.

## Examples

- "Use GitHub to summarize the open PRs in this repo and tell me what needs attention."
- "Help with this PR."
- "Review the latest comments on PR 482 and tell me what is actionable."
- "Debug the failing checks on this branch."
- "Commit these changes, push them, and open a draft PR."
