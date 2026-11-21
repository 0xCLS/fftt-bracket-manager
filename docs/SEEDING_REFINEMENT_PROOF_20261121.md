# Championship seeding refinement — synthetic proof (Nov 21, 2026)

**Status:** Research-only. The official `seedSlots` is unchanged. Do not deploy before FFTT3 or alter player ratings to shape a draw.

The challenge: a top-rated player gets a legitimate first-round bye but may then face the winner of a Level 1 vs Level 1 match, who would be ineligible for Consolation after losing their *second actual* Championship match. This preview changes **only the placement of already-formed opening pairs**, not their opponents, byes, eligibility or match outcomes.

## Checked-in simulations

Fictional fields contain one Level 5, three Level 4, and an assortment of Levels 1–3. A *guaranteed severe post-bye mismatch* means a bye-rated player is three or more levels above **both** participants in the opening match that feeds their next match.

| Check-ins | Levels 1–5 | Current | Candidate | Difference |
| --- | --- | ---: | ---: | ---: |
| 24 | 7, 8, 5, 3, 1 | 1 | 0 | −1 |
| 28 | 8, 9, 7, 3, 1 | 3 | 0 | −3 |
| 31 | 9, 10, 8, 3, 1 | 1 | 0 | −1 |
| 32 | 9, 11, 8, 3, 1 | 0 | 0 | 0 |
| 33 | 10, 11, 8, 3, 1 | 1 | 1 | 0 |

**Important limitation:** The 31-player case can shift a severe second-round mismatch elsewhere between two non-bye opening-match winners. The counts above measure the specific *post-bye* concern, not overall competitive fairness. At 33 check-ins, 31 byes leave only one opening match. The standard seeded path of that match cannot improve through this limited permutation.

## Safety and next decision

- The proposal preserves the *number and recipients* of byes, every first-round pair, and the roster; it only changes pair placement opposite seeded byes. It does not change first-actual-match Consolation eligibility.
- Deterministic synthetic checks compare 24/28/31/32/33; no actual player data is used.
- The official seeding engine, stored results, Staff permissions, scoring, SQL and production websites remain unchanged.
- **Do not merge into the official algorithm on this evidence alone.** Consider full round-two matchup quality and competitive seeding advantages before selecting a final policy; if adopted, update legacy parity tests and verify server acceptance using fictional data under required CI.
