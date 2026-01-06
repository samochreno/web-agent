#!/usr/bin/env python3
"""Regenerate backend/requirements.txt from backend/pyproject.toml."""

from __future__ import annotations

from pathlib import Path
import sys


def load_dependencies(pyproject_path: Path) -> list[str]:
    try:
        import tomllib
    except ModuleNotFoundError:
        raise SystemExit("Python 3.11+ is required to parse pyproject.toml via tomllib")

    with pyproject_path.open("rb") as file:
        data = tomllib.load(file)

    project_data = data.get("project") or {}
    dependencies = project_data.get("dependencies") or []
    if not isinstance(dependencies, list):
        raise SystemExit("Unable to read [project].dependencies from pyproject.toml")
    return [str(dep).strip() for dep in dependencies if isinstance(dep, str) and dep.strip()]


def write_requirements(requirements_path: Path, dependencies: list[str]) -> None:
    requirements_path.parent.mkdir(parents=True, exist_ok=True)
    content = "\n".join(dependencies) + ("\n" if dependencies else "")
    existing = requirements_path.read_text() if requirements_path.exists() else ""
    if existing == content:
        return
    requirements_path.write_text(content)


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    pyproject_path = repo_root / "pyproject.toml"
    requirements_path = repo_root / "requirements.txt"

    if not pyproject_path.exists():
        raise SystemExit(f"Missing {pyproject_path}")

    dependencies = load_dependencies(pyproject_path)
    write_requirements(requirements_path, dependencies)


if __name__ == "__main__":
    main()
