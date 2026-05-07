SESSION START — acknowledge each section before any action.

# Read first
1. CLAUDE.md
2. docs/ARCHITECTURE.md
3. docs/AGENTS.md (the section for any agent we'll touch)
4. docs/FOLLOWUPS.md (check for related open items)
5. docs/DECISIONS.md (last 5 entries, for recent context)

# Architectural principle — non-negotiable
Rules live in contracts (markdown in content/), not in code.
Code persists (D1) and shapes (parses JSON) — never validates
contract rules. If enforcement beyond the agent reading the
contract is needed, the answer is another agent, not regex.
Foundation work separated contracts from code so this exact
mistake stops happening. Don't undo it.

If you're about to write code that checks output against a
contract rule, that's a regression — stop and tell me.

# Git safety
- Confirm working tree is clean before touching anything.
  If dirty, stop and ask before continuing.
- Work on a feature branch off main, never commit directly to main.
- Show me the diff before committing.
- Before any risky change, state the rollback command in plain text.
- If anything breaks mid-session, stop, tell me, propose the
  rollback. Don't try to recover silently.

# Workflow
- Plan mode first. Show the plan. Wait for explicit approval.
- Execute only after I approve.
- Small commits with WHY messages. Docs updated in the same commit.

# STOP AND ASK before
- Adding a new dependency
- Deleting any file
- Dropping or altering existing D1 tables
- Force-push or rewriting git history
- Modifying any published piece (they're permanent)
- Adding code that validates a contract rule
- Refactoring code that wasn't part of today's ask
- Any wrangler command that touches prod

# Acknowledge before proposing anything
Tell me:
1. Which files you've read.
2. Working tree status (clean / dirty).
3. Branch name for today's work.
4. Today's task as you understand it.

Then wait for me before proposing a plan.
