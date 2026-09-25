"""Access runtime files shipped inside the :mod:`graupel` package."""

from __future__ import annotations

from contextlib import contextmanager
from importlib import resources
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Iterator


def package_resource(*parts: str) -> Any:
    """Return a traversable resource without assuming an unpacked package."""
    package_name = __package__.split(".")[0] if __package__ else "graupel"
    resource = resources.files(package_name)
    for part in parts:
        resource = resource.joinpath(part)
    return resource


def model_resource(filename: str) -> Any:
    """Return a model-catalog resource bundled below ``graupel/models``."""
    return package_resource("models", filename)


def icon_resource(filename: str) -> Any:
    """Return an icon resource bundled below ``graupel/icons``."""
    return package_resource("icons", filename)


# Module-level cache: if icons are inside a zip/non-filesystem package we
# materialise the icons directory once and hold on to the TemporaryDirectory
# object (keeping the directory alive) until the process exits.
_icon_temp_dir: "TemporaryDirectory[str] | None" = None


def icon_path(filename: str = "graupel.ico") -> Path:
    """Return a real filesystem :class:`~pathlib.Path` to a packaged icon.

    For a normally installed (unpacked) wheel this is a direct path.  If the
    package is loaded from a zip importer the icon tree is copied to a
    temporary directory that persists for the lifetime of the process.
    """
    global _icon_temp_dir
    resource = icon_resource(filename)
    if not resource.is_file():
        raise FileNotFoundError(f"Packaged icon is missing: {filename}")
    if isinstance(resource, Path):
        return resource

    # Non-filesystem importer: materialise the whole icons directory once.
    if _icon_temp_dir is None:
        _icon_temp_dir = TemporaryDirectory(prefix="graupel-icons-")
        icons_src = package_resource("icons")
        _copy_resource_tree(icons_src, Path(_icon_temp_dir.name))

    return Path(_icon_temp_dir.name) / filename


def _copy_resource_tree(source: Any, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for child in source.iterdir():
        target = destination / child.name
        if child.is_dir():
            _copy_resource_tree(child, target)
        else:
            target.write_bytes(child.read_bytes())


@contextmanager
def frontend_directory() -> Iterator[Path]:
    """Yield the packaged frontend as a real directory for pywebview.

    Wheels are normally installed unpacked, in which case no copy is needed. If
    the package is loaded through a non-filesystem importer, the complete React
    tree is materialized temporarily so relative asset URLs keep working.
    """
    frontend = package_resource("react")
    if not frontend.is_dir():
        raise FileNotFoundError("The packaged React frontend is missing")

    if isinstance(frontend, Path):
        if not (frontend / "index.html").is_file():
            raise FileNotFoundError("The packaged React index.html is missing")
        yield frontend
        return

    with TemporaryDirectory(prefix="graupel-frontend-") as temp_dir:
        materialized = Path(temp_dir) / "react"
        _copy_resource_tree(frontend, materialized)
        if not (materialized / "index.html").is_file():
            raise FileNotFoundError("The packaged React index.html is missing")
        yield materialized
