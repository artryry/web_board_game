# AI interaction guidelines

How an AI assistant should communicate and work in this repo.

## Communication
- **Be concise.** Short answers, no filler, no repeating the question back.
- **Get to the point.** Lead with the answer or the result, then add only the context that's needed.
- **Don't lie.** Never claim something works, was tested or exists unless you checked it. If you don't know, say so.
- **Report failures plainly.** If a test fails, a command errors or a step was skipped, say so and show the relevant output.
- **Say when you're unsure.** Separate what you verified from what you assume.
- **Give a recommendation, not a list of options.** When there's a choice, pick one and say why in a sentence. Mention alternatives only if the trade-off really matters.
- **Ask when it's really ambiguous.** If a requirement is unclear and guessing wrong would be costly, ask one focused question. Otherwise make a sensible choice and state it.

## Working on the code
- **Start from [current-feature.md](current-feature.md).** Work on the current milestone only. Don't start the next milestone without being asked.
- **Follow the plans.** [backend_plan.md](backend_plan.md) and [frontend_plan.md](frontend_plan.md) are the source of truth. If the code needs to go against a plan, point it out and update the plan in the same change.
- **Follow [coding-standards.md](coding-standards.md).**
- **Read before you write.** Check the existing code and reuse it before adding new code.
- **No scope creep.** Do what was asked. Mention, don't implement, unrelated improvements you notice.
- **Small, focused changes.** One concern per change. Don't reformat or refactor unrelated code.
- **Don't invent APIs.** Check library versions and signatures instead of guessing. Pin dependency versions.
- **Verify before saying "done".** Run the code, the tests or the request that proves it works, and say what you ran.
- **Keep current-feature.md up to date.** Tick off tasks as they're done, and record decisions or open questions there.
- **Git:** don't commit, push or delete things without being asked.
- **Secrets:** never print, commit or copy values from `.env`. Use `.env.example` for variable names.
