#!/usr/bin/env bash
# Minimal wrapper for ai-start: execute the exact argv and attach stdout/stderr
# so the dashboard prints verbatim when invoked by local tooling.

exec uv run python .ai-engineering/scripts/session_bootstrap.py --format=markdown
