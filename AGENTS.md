# EVM Skills Hub — Contributor & Authoring Guide

This file orients any agent (or human) working **inside this repository** to add
or maintain skills. It is *not* shipped to users who install a skill — they
receive only the `skills/<name>/` folder. So optimize end-user experience in each
skill's own `SKILL.md`; optimize authoring here.

## What this repo is

A public library of self-contained EVM agent-skills. Each skill installs into any
agent runtime (Claude Code via the plugin, or any runtime that reads the Agent
Skills convention) by copying its folder.

## The canonical skill format

Every skill is a folder under `skills/`:

```
skills/<name>/
├── SKILL.md            # frontmatter (name + description only) + agent-followable body
└── reference/          # distilled, self-contained reference files
```

Rules (enforced by `scripts/validate_skills.py`):
- Frontmatter has exactly `name` and `description`. `name` is kebab-case and
  equals the folder name. `description` is third-person, starts `Use when`,
  states only *triggering conditions* (no workflow summary). Total < 1024 chars.
- The body is instructions an agent reads and acts on — runtime-agnostic
  ("run `slither …` in your shell", never a host-specific tool name).
- Heavy reference material goes in `reference/`, kept self-contained so the skill
  works when installed alone.
- No `scripts/` and no `data/database/`. Pattern data is prose/tables in `reference/`.

Skill body convention: an **Iron Rule**, **When to use / not**, a four-step
**Seek → Innovate → Execute → Manage** workflow, **Verification**, **Quick
Reference**, **Common Mistakes**, **Red Flags**.

## How to add a skill

1. `mkdir -p skills/<name>/reference`.
2. Write `SKILL.md` per the format above; put pattern libraries in `reference/`.
3. Run `python3 scripts/validate_skills.py` — must print OK.
4. Add the skill to the catalog in `README.md`.
5. Bump `version` in `.claude-plugin/plugin.json` if releasing.

## The public/private boundary

Tracked (shipped): `skills/`, `README.md`, `AGENTS.md`, `.claude-plugin/`,
`scripts/`. **No-dead-link invariant:** a tracked file may reference only tracked
paths. The validator fails the build if a tracked file points at a private path.

Private authoring material (personas, research notes) is git-ignored and lives
outside the tracked set; it is never referenced from any tracked file.

## Verification gate

A skill is "done" only after `scripts/validate_skills.py` passes AND a
baseline-vs-with-skill behavior check shows the skill changes agent behavior
(see superpowers:writing-skills).
