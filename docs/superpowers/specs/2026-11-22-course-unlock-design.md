# Course unlock transition

The first course visit after a newly earned medal returns to the completed play on the existing course path, travels to the exact next play, opens its visible lock, and celebrates with a small gold sparkle burst. It finishes with the next play in view and ready to open.

The first course visit after an earned medal must celebrate regardless of the entry route. Compare confirmed account progress with a durable per-account last-shown checkpoint. A missing checkpoint celebrates the latest earned play once. Every later focused visit positions the current unlocked play, or the last completed play when the course is finished. Keep manual browsing free after that initial positioning.

Slow the full sequence to approximately 6.2 seconds: 800 ms at the source, 2,400 ms of synchronized path/page travel, 1,400 ms of lock opening, and 1,600 ms of sparkles. Native scrollToIndex's fixed smooth-scroll speed cannot represent the slower travel; drive page offsets from the same measured path progress. Reduced motion still lands directly.

Use the existing React Native Animated API, AsyncStorage, and editorial gold palette, with no dependencies or changes to progression rules. Derive an account-scoped presentation request from confirmed progress and the local checkpoint. Replays, failed saves, and the final play do not invent unlocks. Locked path nodes show a recognizable lock.

The implementation extends the existing virtualized path. A separate celebration screen would lose the requested spatial connection; automatically opening the next lesson would skip the requested course landing. Checkpoints describe presentation only and cannot grant lesson access. Storage failures preserve the in-memory checkpoint without blocking course use.

Reduced motion lands directly on the unlocked play and records presentation only when that target is actually visible. A normal sequence records presentation after its lock has opened. An interruption before that point leaves the unlock pending for the next visible visit; mounting, focusing, cleanup, and watchdog timeouts alone are not evidence of presentation. Foregrounding retries an unseen interrupted sequence. Ignore legacy v1 markers because they could be written before anything appeared; v2 markers record actual presentation.

The gold connection grows from the completed node center to the next node center using the shared travel value. Render its outgoing and incoming portions inside their own FlatList rows so the next row cannot obscure the final segment. Account generations cannot reuse another session's animation or receipt. Far-away rows use enough measurement retries for the full catalogue. Refreshing progress and remounting the list positions the current play again.

Keep the rail at 3 points wide both during travel and afterward. When travel reaches the next visible node, fill its entire circle gold with a subtle glow and a contrasting dark level number; retain that filled circle for the current play on later visits. The card's padlock opening and sparkle flourish continue with their existing timing and access rules.

Startup must finish native source positioning before animation begins. Require the list's current layout, confirmed scroll position, source visibility, and a brief quiet interval; keep that initial positioning invisible. Cancel and invalidate source positioning retries before showing the source pause and starting travel. A native confirmation arriving before the first animated frame updates its origin, so the first movement cannot jump back to an old offset. Preserve all existing travel, lock, and flourish durations.
