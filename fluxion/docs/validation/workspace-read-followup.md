# Workspace read reduction — experimental follow-up

This is separate from the frozen 0.58 release candidate. It has not been
published in a DMG or verified by a complete native release staging run.

The prior marker-write optimization retained two workspace SessionStore reads
per candidate: lookup followed immediately by the setter's comparison. This
change reuses a successful read only within that synchronous lookup. A failed
first read retains the fresh setter recovery attempt. Direct setters still
read afresh, and no value is cached across selection or restoration events.

Tests execute the shipped lookup, setter, marker plan and native event
subscription functions with keyed SessionStore instrumentation. With 1,000
tabs in one workspace, a full native-selection callback plus its deferred
reconciliation reduces workspace reads from 4,010 to 2,006; 2,000 active-marker
reads remain unchanged. The total is 4,006 instead of 6,010 reads. This is a
counted boundary reduction, not a native latency or CPU benchmark.

Eight new tests cover saved/attribute conflicts, invalid and missing ownership,
failed reads and writes, duplicate markers restored between passes, changed
ownership at restoration, rapid selection and detached/guarded targets.
Separate-window marker tests establish in-memory isolation, not private disk
exclusion. All 625 local tests passed on the implementation tree.

Native selection, cross-window transfer and clean/crash/private recovery must
pass before this follow-up is promoted into a release. Both authoritative
reconciliation passes are intentionally retained.
