"""Write the frontend copies of the quantity registry and built-in layouts.

Run after changing graupel/data/quantities.py or graupel/data/layouts.py:
    python dev-tools/export_quantity_registry.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from graupel.data.layouts import (  # noqa: E402
    FRONTEND_LAYOUTS_PATH,
    render_frontend_layouts,
)
from graupel.data.quantities import (  # noqa: E402
    FRONTEND_REGISTRY_PATH,
    render_frontend_registry,
)


def main() -> None:
    for path, content in (
        (FRONTEND_REGISTRY_PATH, render_frontend_registry()),
        (FRONTEND_LAYOUTS_PATH, render_frontend_layouts()),
    ):
        target = ROOT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        print(f"wrote {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
