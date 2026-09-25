import pytest
from graupel.data.models import Location, WeatherModel, MeteogramConfig
from graupel.data.storage import Storage

import uuid


@pytest.fixture
def storage():
    # Use an in-memory database for testing, with shared cache
    # to allow multiple connections to access the same db in tests
    # Generate a unique path to avoid interference between tests
    db_name = f"file:memdb_{uuid.uuid4().hex}?mode=memory&cache=shared"
    return Storage(db_name)


@pytest.fixture
def sample_config():
    loc = Location(name="Berlin", latitude=52.52, longitude=13.405)
    models = [
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=48),
        WeatherModel(name="GFS", max_forecast_horizon_hours=384),
    ]
    return MeteogramConfig(
        name="Berlin Setup", location=loc, model_chain=models
    )


def test_create_and_read(storage, sample_config):
    created = storage.create(sample_config)
    assert created.id is not None

    read_config = storage.read(created.id)
    assert read_config is not None
    assert read_config.id == created.id
    assert read_config.name == "Berlin Setup"
    assert len(read_config.model_chain) == 2


def test_read_not_found(storage):
    assert storage.read("non-existent-id") is None


def test_update(storage, sample_config):
    created = storage.create(sample_config)

    # Modify the config
    created.name = "Updated Berlin Setup"
    created.model_chain.insert(
        1, WeatherModel(name="ICON-EU", max_forecast_horizon_hours=120)
    )

    updated = storage.update(created)
    assert updated.name == "Updated Berlin Setup"

    # Verify update in storage
    read_config = storage.read(created.id)
    assert read_config.name == "Updated Berlin Setup"
    assert len(read_config.model_chain) == 3


def test_update_not_found(storage, sample_config):
    sample_config.id = "fake-id"
    with pytest.raises(KeyError):
        storage.update(sample_config)


def test_delete(storage, sample_config):
    created = storage.create(sample_config)
    assert storage.read(created.id) is not None

    storage.delete(created.id)
    assert storage.read(created.id) is None


def test_delete_not_found(storage):
    with pytest.raises(KeyError):
        storage.delete("non-existent-id")


def test_list_all(storage, sample_config):
    assert len(storage.list_all()) == 0

    storage.create(sample_config)

    # Create another config
    loc2 = Location(name="Munich", latitude=48.1351, longitude=11.5820)
    config2 = MeteogramConfig(
        name="Munich Setup", location=loc2, model_chain=[]
    )
    storage.create(config2)

    all_configs = storage.list_all()
    assert len(all_configs) == 2
    names = [c.name for c in all_configs]
    assert "Berlin Setup" in names
    assert "Munich Setup" in names


def test_storage_preserves_location_elevation(storage):
    loc = Location(
        name="Lausanne",
        latitude=46.516,
        longitude=6.6328,
        country="Switzerland",
        admin1="Canton of Vaud",
        elevation=453.0,
    )
    cfg = MeteogramConfig(name="Lausanne Setup", location=loc, model_chain=[])
    created = storage.create(cfg)

    read_cfg = storage.read(created.id)
    assert read_cfg is not None
    assert read_cfg.location.name == "Lausanne"
    assert read_cfg.location.elevation == 453.0
    assert read_cfg.location.country == "Switzerland"
    assert read_cfg.location.admin1 == "Canton of Vaud"

    # Update location elevation
    read_cfg.location.elevation = 495.0
    updated = storage.update(read_cfg)
    assert updated.location.elevation == 495.0

    reread = storage.read(created.id)
    assert reread.location.elevation == 495.0


def test_position_tracking_and_reorder(storage):
    loc = Location(name="City", latitude=10.0, longitude=10.0)
    cfg1 = storage.create(
        MeteogramConfig(name="First", location=loc, model_chain=[])
    )
    cfg2 = storage.create(
        MeteogramConfig(name="Second", location=loc, model_chain=[])
    )
    cfg3 = storage.create(
        MeteogramConfig(name="Third", location=loc, model_chain=[])
    )

    configs = storage.list_all()
    assert [c.name for c in configs] == ["First", "Second", "Third"]
    assert [c.position for c in configs] == [0, 1, 2]

    # Reorder to Third, First, Second
    storage.reorder([cfg3.id, cfg1.id, cfg2.id])
    reordered = storage.list_all()
    assert [c.name for c in reordered] == ["Third", "First", "Second"]
    assert [c.position for c in reordered] == [0, 1, 2]


def test_create_at_position_shifts(storage):
    loc = Location(name="City", latitude=10.0, longitude=10.0)
    cfg1 = storage.create(
        MeteogramConfig(name="A", location=loc, model_chain=[])
    )
    cfg2 = storage.create(
        MeteogramConfig(name="B", location=loc, model_chain=[])
    )

    # Insert between A and B at position 1
    cfg_mid = storage.create(
        MeteogramConfig(name="Mid", location=loc, model_chain=[]), position=1
    )
    configs = storage.list_all()
    assert [c.name for c in configs] == ["A", "Mid", "B"]
    assert [c.position for c in configs] == [0, 1, 2]


def test_delete_shifts_positions(storage):
    loc = Location(name="City", latitude=10.0, longitude=10.0)
    cfg1 = storage.create(
        MeteogramConfig(name="A", location=loc, model_chain=[])
    )
    cfg2 = storage.create(
        MeteogramConfig(name="B", location=loc, model_chain=[])
    )
    cfg3 = storage.create(
        MeteogramConfig(name="C", location=loc, model_chain=[])
    )

    # Delete middle config
    storage.delete(cfg2.id)
    configs = storage.list_all()
    assert [c.name for c in configs] == ["A", "C"]
    assert [c.position for c in configs] == [0, 1]


def test_location_history_recording_and_ranking(storage):
    loc_berlin = Location(
        name="Berlin",
        latitude=52.5200,
        longitude=13.4050,
        elevation=34.0,
        country="Germany",
        admin1="Berlin",
        timezone="Europe/Berlin",
    )
    loc_munich = Location(
        name="Munich",
        latitude=48.1351,
        longitude=11.5820,
        elevation=519.0,
        country="Germany",
        admin1="Bavaria",
        timezone="Europe/Berlin",
    )
    loc_hamburg = Location(
        name="Hamburg",
        latitude=53.5511,
        longitude=9.9937,
        elevation=6.0,
        country="Germany",
        admin1="Hamburg",
        timezone="Europe/Berlin",
    )

    # Initially empty
    assert storage.get_most_used_locations(10) == []

    # Record Berlin once
    storage.record_location_selection(loc_berlin)
    # Record Munich twice
    storage.record_location_selection(loc_munich)
    storage.record_location_selection(loc_munich)
    # Record Hamburg 3 times
    storage.record_location_selection(loc_hamburg)
    storage.record_location_selection(loc_hamburg)
    storage.record_location_selection(loc_hamburg)

    top = storage.get_most_used_locations(10)
    assert len(top) == 3
    assert [loc.name for loc in top] == ["Hamburg", "Munich", "Berlin"]
    assert top[0].elevation == 6.0
    assert top[1].country == "Germany"

    # Test near-coordinate deduping (within 4 decimal places)
    loc_berlin_near = Location(
        name="Berlin Center",
        latitude=52.52004,
        longitude=13.40498,
        elevation=35.0,
        country="Germany",
        admin1="Berlin",
        timezone="Europe/Berlin",
    )
    # Berlin should now have 2 counts and tie with Munich, or pass if selected again
    storage.record_location_selection(loc_berlin_near)
    storage.record_location_selection(loc_berlin_near)
    storage.record_location_selection(loc_berlin_near)
    # Berlin now has 4 selections (1 original + 3 near) -> top
    top_after = storage.get_most_used_locations(2)
    assert len(top_after) == 2
    assert [loc.name for loc in top_after] == ["Berlin Center", "Hamburg"]

