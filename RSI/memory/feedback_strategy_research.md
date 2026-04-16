---
name: Strategy Research Preferences
description: How the user approaches strategy research — what to optimize for, how to present results
type: feedback
originSessionId: ec260109-55dd-42c6-882c-a908d1ac26ca
---
# User prefers aggressive configs when edge is confirmed

When a strategy has been validated through a full sweep and the regime/filter is solid,
the user chooses the aggressive config (highest Calmar, not conservative fallback).

**Why:** They understand that a good Calmar at higher returns is strictly better than
lower returns at similar risk, especially when position sizing can be adjusted.

**How to apply:** When presenting config options (conservative / balanced / aggressive),
the user will typically pick aggressive. Present the trade-offs clearly but don't
over-hedge or push them toward conservative.

---

# Focus findings, don't re-sweep what's already confirmed

When exploring a strategy, avoid running large redundant sweeps over already-confirmed
parameters. Instead, lock confirmed filters and only sweep the open question.

**Why:** Compute-heavy sweeps with already-known dimensions waste time and can introduce
look-ahead bias when re-optimizing settled parameters.

**How to apply:** Identify the specific unknown (e.g. "does a lock mechanism help?",
"what's the best TP?"), fix everything else, run the targeted sweep.

---

# BAL+MED is a known drag — don't include it

In any study that splits by regime, BAL+MED consistently produces negative Calmar
and drags down combined results. It's been tested and rejected.

**Why:** The medium-vol balanced regime is choppy — no clear trending or mean-reversion
character. Signals fire but don't resolve cleanly in either direction.

**How to apply:** When building new strategies or filtering existing ones, exclude BAL+MED
from the start. Don't even run it as a comparison unless specifically asked.

---

# Wick stop underperforms ATR in BAL+HIGH

In BAL+HIGH regime specifically, the ATR stop dominates the wick stop.
Opposite of what's seen in other regimes (BAL+LOW, IMBAL+LOW where wick helps).

**Why:** In HIGH vol, the sweep bar itself carries enough force that the entry bar's
range is the natural risk anchor. The wick low IS the structural stop for institution-
absorbed fakeouts — there's no need for extra buffer.

**How to apply:** For BAL+HIGH strategies, default to ATR stop. Only test wick stop
as a comparison, not as the primary variant.
