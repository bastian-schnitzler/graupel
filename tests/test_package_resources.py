from pathlib import Path
import sys
from types import SimpleNamespace

from graupel.data.open_meteo import _load_raw_catalog_file
from graupel.resources import frontend_directory, model_resource


def test_model_catalogs_are_package_resources():
    assert model_resource("model_catalogue.json").is_file()
    assert model_resource("model_catalog.json").is_file()
    assert len(_load_raw_catalog_file()) >= 30


def test_frontend_resource_tree_can_be_materialized():
    with frontend_directory() as frontend:
        assert isinstance(frontend, Path)
        index = frontend / "index.html"
        assert index.is_file()
        markup = index.read_text(encoding="utf-8")
        assert markup.count("<title>Graupel</title>") == 1
        assert "<title>Cumulus</title>" not in markup
        assert any((frontend / "assets").iterdir())


def test_application_uses_packaged_frontend_outside_project(
    monkeypatch, tmp_path
):
    import graupel.__main__ as entrypoint

    calls = []
    fake_webview = SimpleNamespace(
        create_window=lambda *args, **kwargs: calls.append((args, kwargs)),
        start=lambda **kwargs: calls.append(("start", kwargs)),
    )
    monkeypatch.setitem(sys.modules, "webview", fake_webview)
    monkeypatch.setattr(entrypoint, "API", lambda *args: object())
    monkeypatch.chdir(tmp_path)

    entrypoint.main(SimpleNamespace(invoked_subcommand=None))

    window_args, _ = calls[0]
    index_path = Path(window_args[1])
    assert index_path.is_absolute()
    assert index_path.name == "index.html"
    assert index_path.parent.name == "react"
    assert calls[1][0] == "start"


def test_zip_resources_keep_shortcut_icon_after_process_exit(tmp_path):
    import os
    import subprocess
    import zipfile
    import graupel
    package = Path(graupel.__file__).parent
    archive = tmp_path / "graupel.zip"
    with zipfile.ZipFile(archive, "w") as zipped:
        for name in ("__init__.py", "config.py", "resources.py", "windows_integration.py"):
            zipped.write(package / name, "graupel/" + name)
        for folder in ("icons", "react"):
            for resource in (package / folder).rglob("*"):
                if resource.is_file():
                    zipped.write(resource, "graupel/" + str(resource.relative_to(package)))
    script = '''
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from graupel.resources import icon_path, frontend_directory
from graupel.windows_integration import _shortcut_icon_path
assert icon_path().is_file()
with frontend_directory() as frontend:
    assert (frontend / 'index.html').is_file()
print(_shortcut_icon_path())
'''
    result = subprocess.run(
        [sys.executable, "-c", script, str(archive)], cwd=tmp_path,
        env={**os.environ, "LOCALAPPDATA": str(tmp_path / "Local")},
        check=True, text=True, capture_output=True,
    )
    durable = Path(result.stdout.strip())
    assert durable.is_file()
    assert durable.read_bytes() == (package / "icons/graupel.ico").read_bytes()
