---
description: Cut a movi-player release — hand the version bump to the release-manager agent
argument-hint: "[patch|minor|major|X.Y.Z] [--package] [--deploy]"
---

Hand this release off to the **release-manager** subagent — it takes full responsibility for the bump.

Target: **$ARGUMENTS** (if empty, ask which of patch / minor / major / explicit version).

Spawn the `release-manager` agent (via the Agent tool, `subagent_type: "release-manager"`) and have it run its full process: draft the CHANGELOG `## [Unreleased]` notes from `git log <last-tag>..HEAD` in both `CHANGELOG.md` and `docs/changelog.md`, get your approval on the notes + version, dry-run `npm run release -- <version>`, then run it for real, and verify every package / doc / target bumped consistently.

Relay the agent's drafted notes and its final report back to me. Do **not** commit, tag, push, publish, or deploy unless I explicitly approve that step.
