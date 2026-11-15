"""Agent Skills loader (Agent Skills format: YAML frontmatter + markdown body).

Progressive loading: the agent first sees only name + description of every skill (catalog),
then loads the full SKILL.md of the one it picks.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from functools import lru_cache

import yaml

from . import config


@dataclass
class Skill:
    name: str
    description: str
    body: str
    path: str
    steps: list[str] = field(default_factory=list)

    def step(self, n: int) -> str:
        return self.steps[n - 1] if 0 < n <= len(self.steps) else ""


_FRONT = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.S)


def parse_skill(text: str, path: str = "") -> Skill:
    m = _FRONT.match(text)
    if not m:
        raise ValueError(f"{path}: SKILL.md must start with YAML frontmatter")
    meta = yaml.safe_load(m.group(1)) or {}
    body = m.group(2).strip()
    steps: list[str] = []
    sec = re.search(r"^## Diagnosis steps\s*\n(.*?)(?=^## |\Z)", body, re.S | re.M)
    if sec:
        steps = [re.sub(r"^\d+\.\s*", "", line).strip()
                 for line in sec.group(1).splitlines() if re.match(r"^\d+\.\s", line.strip())]
    return Skill(name=meta["name"], description=str(meta.get("description", "")).strip(), body=body, path=path, steps=steps)


@lru_cache(maxsize=1)
def load_all() -> dict[str, Skill]:
    skills: dict[str, Skill] = {}
    for d in sorted(os.listdir(config.SKILLS_DIR)):
        p = os.path.join(config.SKILLS_DIR, d, "SKILL.md")
        if os.path.isfile(p):
            with open(p, encoding="utf-8") as f:
                s = parse_skill(f.read(), p)
            skills[s.name] = s
    return skills


def catalog() -> list[dict]:
    """What the agent sees first: only names and descriptions."""
    return [{"name": s.name, "description": s.description} for s in load_all().values()]


def get(name: str) -> Skill | None:
    return load_all().get(name)


# Which remediation skill fits a triaged category (mock planner + fallback)
CATEGORY_TO_SKILL = {
    "Lot Hold": "lot-hold-stuck",
    "Recipe Mismatch": "trackin-recipe-mismatch",
    "Heartbeat Stale": "equipment-heartbeat-stale",
    "SECS-GEM Timeout": "interface-timeout",
    "Permission Missing": "user-permission-missing",
    "Slow Query": "db-slow-query",
}
