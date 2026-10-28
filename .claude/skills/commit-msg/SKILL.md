---
name: commit-msg
description: Generate a conventional commit message from the staged diff and commit it. Use when the user says "write a commit message", "generate a commit", "commit my changes", or runs /commit-msg.
---

# commit-msg

Commit the **staged** changes with a generated message. Never stage files yourself.

## 1. Check that something is staged

Run:

```bash
git diff --staged --stat
```

If the output is empty, **stop**. Tell the user: "Nothing is staged — stage your changes first (e.g. `git add <files>`)." Don't run any other git command.

## 2. Read the staged diff

```bash
git diff --staged
```

If the diff is very large, read `--stat` first and then the diff file by file. Base the message only on what is staged. Ignore unstaged and untracked files.

## 3. Write the message

Format:

```
type(scope): short subject

- what changed
- why it changed
```

- **type** is exactly one of `feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `test`. Pick the one that fits the main purpose of the change.
- **scope** is the main area touched, in lowercase. Prefer this project's areas: `backend`, `engine`, `api`, `ws`, `db`, `frontend`, `game-ui`, `infra`, `nginx`, `context`. If no single area fits, leave the scope out: `type: subject`.
- **subject** is in the imperative mood ("add", not "added"), lowercase, with no trailing period, and **under 60 characters** for the whole first line.
- **body** is optional but encouraged. Use short `- ` bullets that say what changed and why. Leave it out for trivial changes.
- **Never add a `Co-Authored-By` trailer** or any other attribution line.

## 4. Commit

Use the Bash tool with a quoted heredoc so the multi-line message is kept exactly as written:

```bash
git commit -F - <<'EOF'
type(scope): short subject

- what changed
- why it changed
EOF
```

- Don't use `--no-verify` or `--amend`, and don't add `-a`.
- If a pre-commit hook fails, show its output, fix nothing on your own, and stop.
- On success, show the user the commit hash and the message (`git log -1 --oneline`).
