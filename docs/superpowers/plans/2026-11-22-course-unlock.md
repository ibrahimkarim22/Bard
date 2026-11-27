# Course Unlock Implementation Plan

> **For agentic workers:** Use the normal implementation and review workflow. Steps use checkbox syntax for tracking.

**Goal:** Celebrate a new completion on the first course visit from any entry route, then return subsequent visits to the current unlocked play.

**Architecture:** A durable per-account checkpoint and confirmed progress derive pending unlocks inside CourseScreen. A course hook coordinates virtual-list positioning and a cancellable 6.2-second sequence; a visual component draws the path pulse, lock, and sparkles. The same measured travel value drives the path and page scroll.

**Tech Stack:** Existing React Native, Animated, React Navigation, Node test runner.

**Spec:** docs/superpowers/specs/2026-11-22-course-unlock-design.md

## Constraints and review focus

Preserve other working-tree edits and existing progress writes. No dependencies. Verify saved versus replay/failure/final-play behavior, large-index virtualization, reduced motion, interruption and account replacement, and one-time consumption.

## Tasks

- [x] Write and run failing tests for the quiz navigation contract; implement only confirmed new unlock handoffs and stale-tap protection.
- [x] Write and run failing tests for course positioning, ordered travel/unlock/burst, reduced motion, scrolling retries, and cancellation.
- [x] Implement the course transition hook, decorative native animations, and visible locks on the existing map.
- [x] Run course regressions and relevant repository checks, request independent review, and correct material findings.

Work in the supplied checkout on refractor/updateUI. Existing user edits in medal components and highlight recovery are outside this change. Leave changes uncommitted for review.

## Follow-up tasks

- [x] Add durable, account-scoped last-shown checkpoints and derive pending unlocks from confirmed course progress on any course entry.
- [x] Slow path and page movement together, then slow padlock opening and sparkles.
- [x] Position the current unlocked play on every subsequent focused visit; preserve virtualization retries and manual-scroll cancellation.
- [x] Verify cold starts, navigation from other pages, revisits, different accounts, final play, reduced motion and interruptions; review and run regressions.

## Verification

## Skipped-entry and growing-line correction

- [x] Reproduce active course mount followed by blur before layout: the old code advanced the durable checkpoint with zero animations.
- [x] Gate receipts on actual lock presentation or a visible explicit reduced-motion landing. Preserve pending rewards across unseen blur/unmount, interruptions, foreground resume, and layout timeouts.
- [x] Replace unreliable v1 markers with v2 presentation checkpoints so an already-suppressed reward can appear once.
- [x] Draw outgoing and incoming rail segments locally in their respective rows, using one continuous travel value to reach the next node center.
- [x] Add a shared-history integration regression covering a retained course beneath Quiz, an unseen handoff, and the later visible course entry.
- [x] Complete independent review and final regression run for this correction.

Correction verification: the full local course/reader/content/development regression command passed 1,499 tests with zero failures; `git diff --check` passed. Independent review found no important defects. The connected handoff regression failed before the receipt fix and passed after it. Native UI inspection remains unavailable under the existing computer-use permissions.

## Previous verification

## Startup-jerk correction

- [x] Reproduce delayed native source acknowledgment, positioning retries fighting travel, and cached visibility starting before replacement-list layout.
- [x] Add a native-confirmed, layout-ready positioning barrier; hide only setup and reveal the settled source before its existing pause.
- [x] Fence retry callbacks by request identity and cancel source retries before animated travel owns scrolling.
- [x] Accept late source confirmation before the first travel frame and update test fixtures to acknowledge native scrolls realistically.
- [x] Complete independent review and final course regressions.

Startup verification: all 432 course tests passed on the final code, including four regressions that failed before the fix. The connected arrival fixture now acknowledges native scrolling instead of assuming programmatic commands complete immediately. Independent review found no important new defects; `git diff --check` passed. On-device smoothness remains unverified under the existing computer-use permissions.

Final follow-up regression command: `node --test --test-concurrency=4 tests/course/*.test.cjs tests/reader/*.test.cjs tests/content/*.test.cjs tests/development/*.test.cjs`. Result: 1,491 passed, zero failures. `git diff --check` passed. Coverage includes route-independent course arrival, durable unmount receipts, owner generation changes, progress refresh, foreground deferral, and late-course measurement retries. Independent review has no remaining material findings.

The earlier implementation passed 1,466 local tests and compiled an isolated React Native web preview. Interactive inspection was blocked by browser computer-use permissions. Temporary preview files and servers were removed.
