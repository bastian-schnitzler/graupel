import pytest

from graupel.data.open_meteo import OpenMeteoClient


@pytest.fixture(autouse=True)
def _no_model_metadata_requests(monkeypatch):
    """Tests never reach the Open-Meteo metadata endpoint."""

    async def no_metadata(self, model_id):
        return {}

    monkeypatch.setattr(OpenMeteoClient, "fetch_model_metadata", no_metadata)
    monkeypatch.setattr(
        OpenMeteoClient, "fetch_ensemble_metadata", no_metadata
    )


@pytest.fixture(autouse=True)
def _no_single_run_requests(monkeypatch):
    """Tests never reach the Open-Meteo Single Runs API."""

    async def no_single_run(self, *args, **kwargs):
        return {}

    monkeypatch.setattr(OpenMeteoClient, "fetch_single_run", no_single_run)


class _MemoryDataDirBackend:
    def __init__(self):
        self.value = None

    def read(self):
        return self.value

    def write(self, path):
        self.value = path

    def clear(self):
        self.value = None


@pytest.fixture(autouse=True)
def data_dir_backend(monkeypatch):
    """Tests never touch the real registry, user defaults or config file."""
    import graupel.data_location as data_location

    backend = _MemoryDataDirBackend()
    monkeypatch.setattr(data_location, "_backend", lambda: backend)
    return backend
