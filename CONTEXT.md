# Sprout

Sprout is a CLI that spins up discrete experiments in one central place. Trying an idea should cost a single command.

## Language

**Experiment**:
One self-contained attempt at an idea, kept in its own directory directly under the root, with a short description. Any such directory is an experiment, whoever created it.
_Avoid_: Sprout, seed, project, sandbox

**Root**:
The one central directory that holds every experiment, side by side.
_Avoid_: Workspace, home, base

**Name**:
An experiment's short label: its directory name, minus any `YYYY-MM-DD-` date in front, which older experiments carry. It is lowercase words joined by dashes.
_Avoid_: Slug, title
