# Variety investigation — where the library bias enters

Written 2026-05-10. Read-only investigation; no code touched.

The Library shows 59 published pieces across 11 categories. Roughly
60% sit in biology / brain / medicine / science. Another 35% sit in
governance / trade / justice / infrastructure / business. There is
one Language piece. Zero on entertainment, pop culture, sports,
food, fashion, music, lifestyle, or arts.

This document walks through where that shape comes from. It does
not recommend a fix.

## 1. Where candidates come from

The Scanner runs four times a day (cron + admin retriggers) and
pulls from 10 RSS feeds. All 10 are Google News:

| Feed | Topic |
|---|---|
| TOP | Wire-service top stories |
| TECHNOLOGY | Tech / consumer / enterprise / AI |
| SCIENCE | Science topic feed |
| BUSINESS | Markets / corporate |
| HEALTH | Public health / disease / wellness |
| WORLD | International politics / conflict |
| ENTERTAINMENT | Celebrity / film / TV / music (added 2026-05-09) |
| SPORTS | Scores / players / leagues (added 2026-05-09) |
| FOOD_COOKING | Search query `food cooking science` (added 2026-05-09) |
| PERSONAL_FINANCE | Search query `personal finance` (added 2026-05-09) |

The six legacy feeds (TOP, TECHNOLOGY, SCIENCE, BUSINESS, HEALTH,
WORLD) have run since launch. The four entertainment / sports / food
/ personal-finance feeds were added 2026-05-09 with PR #1. Eleven
narrow-academic breadth feeds (AEON, QUANTA, JSTOR_DAILY,
ATLAS_OBSCURA, NAUTILUS, PHYS_ORG, LIVE_SCIENCE, NEW_SCIENTIST,
KNOWABLE, SMITHSONIAN, TECH_REVIEW) ran between 2026-05-01 and
2026-05-09, then got removed for biasing the pool toward
hard-science.

There are no arts feeds (no NYRB, no Pitchfork, no Criterion). No
craft or trade feeds. No lifestyle or fashion feeds. No regional
feeds outside the US-default Google News locale.

Per-feed cap is 8 candidates per run; global cap is 24 after
dedup (the 80→24 cut from 2026-05-10 priority 1). Today's four runs
produced ~78 candidates each pre-cap, ~24 post-cap. The pool is
broad enough to carry the eight feed shapes every run.

**Flag:** the FOOD_COOKING search query is `food cooking science`.
Recent results are dominated by college culinary programs and Nature
papers on emulsions and laser-printed food — not how people cook
or eat. The query as written biases the food feed toward academic
food-science, not skills or culture. (Investigation flag, not a fix.)

## 2. What a typical candidate pool looks like

The 9-10 May window (the first two days the new feeds were live)
produced 645 candidate rows across 8-10 runs. Per-feed distribution:

| Feed | Candidates | Picks | off_topic | tribal | already_covered |
|---|---|---|---|---|---|
| TOP | 76 | 1 | 0 | 16 | 24 |
| TECHNOLOGY | 76 | 1 | 29 | 0 | 1 |
| SCIENCE | 76 | 4 | 12 | 0 | 12 |
| BUSINESS | 67 | 0 | 13 | 5 | 4 |
| HEALTH | 60 | 2 | 11 | 0 | 9 |
| WORLD | 58 | 0 | 5 | 7 | 24 |
| SPORTS | 56 | 0 | **43 (77%)** | 1 | 0 |
| FOOD_COOKING | 56 | 0 | **34 (61%)** | 0 | 0 |
| ENTERTAINMENT | 56 | 0 | **35 (63%)** | 2 | 0 |
| PERSONAL_FINANCE | 50 | 0 | **22 (44%)** | 2 | 0 |

The four new feeds carry 218 candidates over two days. Zero picks.
Between 44% and 77% of each new feed's output gets stamped
`off_topic` and dropped from serious consideration.

For comparison, TOP carries 76 candidates and gets 0% off_topic.
SCIENCE 16%, HEALTH 18%. The Curator treats the four new feeds as
a structurally different shape of input.

The actual ENTERTAINMENT candidates look mixed. Recent headlines:

- WWE Backlash 2026 Results As Roman Reigns Cheats
- Britney Spears Detoxes From Substance Abuse In Camden, Maine
- Horoscope for Sunday, May 10, 2026
- The Cannes Film Festival is about to begin
- Attenborough at 100: The region where Sir David learned to love wildlife
- Bobby Cox, One of Baseball's Top Managers, Dies at 84

The first three are gossip and would defensibly land as `off_topic`
or `low_signal`. The last three carry a teachable angle (festivals
as cultural ritual; a single voice shaping public understanding;
what a long managerial career teaches about decision-making). None
appear in any run's top-10 weighed list (see below).

PERSONAL_FINANCE candidates look strong on average:

- Why does Walmart reject contactless card payments
- Crypto-backed mortgages are hitting the mainstream
- Dying with a health savings account can leave a tax bomb for heirs
- Sandwich generation needs to budget for kids and parents

These connect to payment infrastructure, financialisation, estate
mechanics, and demographic shifts. Zero picks.

## 3. What the Curator actually weighs

The Curator records a `rejectionReason` (one-sentence reasoning)
only for the **top 10** candidates it weighed most seriously before
settling on the pick. The remaining rejections get a one-token
`rejectionCategory` and no reasoning. The reasoning tier is the
signal for what the Curator is actually thinking about.

Since 2026-05-07, candidates that reached the top-10 reasoning tier
came from exactly two feeds:

| Feed | Top-10 reasoning entries |
|---|---|
| TOP | 82 |
| TECHNOLOGY | 16 |
| All other feeds | 0 |

Zero entries from SCIENCE, HEALTH, BUSINESS, WORLD, ENTERTAINMENT,
SPORTS, FOOD_COOKING, PERSONAL_FINANCE. Even the feeds that produce
picks (SCIENCE, HEALTH) don't surface close-call alternatives —
which suggests the picks land alone in their tier, and the
close-calls all sit elsewhere.

The reasoning the Curator did write is mostly `already_covered`:

> "Same news event as recent pieces on Ukraine-Russia ceasefire and
> war dynamics."
>
> "Same underlying concept as recent infrastructure pieces (grid
> strain, resource competition)."
>
> "Hormuz chokepoint tensions — same SAME-CONCEPT as recent
> pieces."

The duplicate-prevention rules are doing real work: 107 of the last
~520 rejections fired `already_covered`, mostly on TOP and WORLD
news events the library has already absorbed.

## 4. What the Categoriser allows

The current taxonomy (from D1, `categories` table):

| Slug | Name | Pieces | Locked |
|---|---|---|---|
| science | Science | 16 | yes |
| governance | Governance | 10 | yes |
| brain | Brain | 7 | yes |
| trade | Trade | 7 | yes |
| biology | Biology | 6 | yes |
| medicine | Medicine | 6 | yes |
| justice | Justice | 4 | yes |
| infrastructure | Infrastructure | 3 | yes |
| business | Business | 2 | yes |
| ecology | Ecology | 2 | yes |
| language | Language | 1 | **no** |
| patterns-yet-to-cluster | Patterns Yet to Cluster | 0 | yes (hidden) |

Ten reader-visible locked categories + one unlocked (Language) +
one hidden fallback. Language is the only category to land
auto-created after the 2026-05-07 fragmentation cleanup — the
mechanism that allows new categories DOES work; it has fired exactly
once in 33 days.

The Curator's `pick_domain` enum has 10 values: inner-life, meaning,
expression, language, science, body, how-humans-live, skills,
technology, time-and-place. Map them to the existing 10
reader-visible categories:

| pick_domain | Library category that would hold it |
|---|---|
| inner-life | Brain (partial — covers neuroscience, not psychology) |
| meaning | **No category** |
| expression | **No category** |
| language | Language (1 piece) |
| science | Science / Biology / Ecology |
| body | Medicine |
| how-humans-live | Governance / Trade / Justice / Business |
| skills | **No category** |
| technology | Infrastructure (partial — covers crisis, not how things work) |
| time-and-place | **No category** |

Four of the ten domains have no library home. A piece whose
teaching lens is `expression`, `meaning`, `skills`, or
`time-and-place` would require a new category proposal.

The Categoriser contract is strict about new categories. The most
important rule is **"prefer reuse over novelty"**, with a tier-1 /
tier-2 / tier-3 ladder where tier-3 (new category) fires only when
no existing category fits even at 60% confidence. The contract is
written to converge the taxonomy, not expand it. That's by design
after the 2026-05-07 fragmentation cleanup that collapsed 27
categories into 10.

The contract is not biased against entertainment topics per se. The
description rule names domains, not intellectual moves; the names
rule allows single-word category names that could include
`Culture`, `Expression`, `Skills`, etc. If the Curator picked a
strong entertainment piece, the Categoriser COULD propose a new
category — but only once per piece, and only after walking through
every existing category and finding no fit at 60%.

## 5. What's actually in each category

Sampling 3-5 pieces per category from D1:

**Science (16 pieces) — pattern recognition and how knowledge accumulates**
- New ultra stainless steel stuns researchers
- A close brush with Mars will reshape NASA's Psyche journey
- Surge in fake citations uncovered by audit of biomedical papers
- Detection of an atmosphere on a trans-Neptunian object
- Cambrian Fossils Rewrite the Story of Early Life

**Governance (10) — institutional design**
- UFO files spanning decades are released by Defense Department
- Israeli strikes on southern Lebanon despite ceasefire
- Supreme Court limits key provision of the Voting Rights Act
- Trump administration reclassifies cannabis as less dangerous

**Brain (7) — neuroscience and embodied cognition**
- Psychologists Say People Who Still Use Paper Calendars... Their Brain
- Walking Slower? Why Your Ears, Not Your Knees, Might Be the Problem
- Specific expansion of motor cortical projections in a singing mouse
- Single dose of magic mushroom psychedelic can cause brain changes

**Trade (7) — supply chains and chokepoints**
- UAE leaves OPEC in major blow to global oil producers
- Trump administration begins refunding $166bn in tariffs
- Hormuz Shipping Traffic Grinds to a Halt
- Airline industry faces a shakeup as jet fuel hits hard

**Biology (6) — evolution, immunology, cellular**
- Fossil whose legs were built like
- The Hidden Mathematical Dance Inside Plant Cells
- Researchers try to cut the genetic code from 20 to 19 amino acids

**Medicine (6) — diagnosis under uncertainty**
- The body's most mysterious organ may play a key role in longevity
- Doctors told her to remove her uterus. The real cause was elsewhere.
- Finding 'hidden sperm': New technique offers hope to infertile men

**Justice (4) — state violence and institutional failure**
- 5 wounded in possible stabbing attack at Washington state high school
- New Orleans sheriff indicted on charges of failing to prevent jailbreak
- Justice Department allows firing squads for executions

**Infrastructure (3) — critical systems**
- The most severe Linux threat to surface in years
- Maine vetoes ban on data center construction
- $12.5 billion brings air traffic control out of 1990s

**Business (2), Ecology (2), Language (1)** — small categories.

The categories are internally clean. Each headline genuinely fits
its bucket. No misfiles, no obvious force-fits. The taxonomy is
narrow but the pieces within each bucket are coherent.

## 6. Where the variety gap enters

The gap is doing work at three places, reinforcing each other.

**Feed-level (Scanner) — partial gap.** The four new feeds carry
entertainment / sports / food / personal-finance candidates as
intended. PERSONAL_FINANCE in particular produces strong material.
SPORTS and ENTERTAINMENT carry a mix of teachable angles and pure
gossip. FOOD_COOKING is narrow — the search query biases toward
"food science" rather than how people actually cook or eat. There
are NO feeds at all for arts (books, film criticism, theatre),
craft (gardening, building, repair), music, or anything outside
the US-default news locale. Score: feeds carry SOME of what's
missing, miss other parts entirely.

**Curator-level — biggest gap.** The four new feeds produce 218
candidates in 2 days with 0 picks and 60-77% `off_topic` rejection
rate. None of the 218 reach the top-10 reasoning tier. The
Curator's contract is breadth-aware — it explicitly invites
celebrity / sport / cooking / culture — but the LLM's read of
"teachability" stamps `off_topic` on these candidates without
serious weighing. The contract is correct; the execution is not.
Score: even when feeds DO carry good entertainment/skills/finance
material, the Curator default-rejects most of it.

**Categoriser-level — quiet gap.** The library has 10 visible
reader categories; the Curator's pick_domain enum has 10 domains.
Four domains (meaning, expression, skills, time-and-place) have NO
library home, and a fifth (inner-life) is only partly covered by
Brain. If the Curator did pick an entertainment piece, the
Categoriser would face a one-new-category-per-piece ceiling and
strong "prefer reuse" pressure. The result would likely be a
force-fit into Science or Knowledge, or a fallback to
`patterns-yet-to-cluster`. Score: small effect today because the
Curator rarely picks entertainment / arts / skills material, but
real backstop if the Curator's behaviour changed.

Most of the work is being done by the Curator. The feeds carry the
candidates; the system throws them out before serious weighing.

## Ranked options — not recommendations, just the surface

If we wanted to change this, the levers exist at all three places:

1. **Tighten the FOOD_COOKING feed query.** Current query
   `food cooking science` biases toward academic food science.
   `cooking restaurants` or `food culture` would surface different
   candidates. Lowest-cost option, easiest to revert.

2. **Add feeds in untouched domains.** Arts (NYRB, theatre, music
   criticism), craft (gardening, sport-as-craft), regional
   (non-US-locale Google News, BBC topic feeds). Each verified
   feed adds ~8 candidates per run pre-cap.

3. **Change the Curator's `off_topic` posture on new feeds.** The
   current contract definition leans automatic on sports betting
   odds and hyperlocal traffic notices, but doesn't say "default
   to off_topic for the whole feed." Behaviour comes from the LLM's
   read, not the contract. Options range from contract clarification
   ("when in doubt on entertainment/sports/food, write a reasoning
   sentence before rejecting") to changing the soft preference
   from "prefer thinner library categories" to "prefer thinner
   pick_domains" — since pick_domain is the 10-domain breadth view
   and library categories are the 10-category history view.

4. **Expand the library taxonomy.** Add `Expression`, `Skills`,
   `Meaning`, `Time-and-place` as locked categories. Removes the
   one-new-per-piece bottleneck for the four currently-homeless
   pick_domains. Risk: re-fragments the taxonomy that the 2026-05-07
   cleanup tightened.

5. **Adjust the `pick_domain` enum and the recent-domain block in
   the Curator prompt.** The prompt already shows the Curator the
   trailing-30-day domain distribution. The leverage is the
   strength of the preference toward thinner domains. Currently
   soft; could be made stronger without becoming a hard rule.

Higher-numbered options have larger blast radius. Lower-numbered
options are reversible inside a day.

## Flags surfaced during the investigation

Not the topic of this doc, but worth noting in one place:

- **GLOBAL_CAP=24 trim deploy timing.** The 2026-05-10 priority 1
  commit cut GLOBAL_CAP from 80 to 24, but today's four runs
  produced ~78 candidates each (78, 78, 77, 79). Either the deploy
  has not landed in production yet, or the cap is being bypassed
  upstream. Worth a check against the deployed worker.

- **Stale rows from removed feeds.** The `daily_candidates` table
  still carries rows from the 8 academic feeds removed on
  2026-05-09 (PHYS_ORG, NAUTILUS, etc.). Historical residue, not
  active.

- **187 candidates over the last 4 days have no `rejection_category`
  set despite being un-selected.** Pre-Task-03 rows or candidates
  the Curator didn't reach. Probably benign but worth understanding
  if the meter ever wants to compute clean rejection rates.

- **The Categoriser's `patterns-yet-to-cluster` fallback has zero
  pieces.** The retry mechanism that catches taxonomy misses has
  not fired since the 2026-05-07 cleanup. Healthy signal — pieces
  ARE finding existing buckets — but also means there is no
  fallback signal to learn from yet.

---

Given all of this, what does Daylila *want* to cover?
