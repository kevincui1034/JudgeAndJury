"""``python -m proofjury`` — how detached intent workers re-enter the CLI
(the console script may not be on PATH in every hook environment, but the
running interpreter always resolves itself)."""

from .cli import main

if __name__ == "__main__":
    main()
