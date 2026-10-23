"""Creates tests/fixtures/graupel-0.1.0.db with the released graupel 0.1.0.

Defaults, one edited and one own configuration, a reorder and location
history. Run it with graupel 0.1.0 from PyPI, not with this checkout:

    uv venv /tmp/g010 && VIRTUAL_ENV=/tmp/g010 uv pip install graupel==0.1.0
    /tmp/g010/bin/python -I tests/fixtures/make_graupel_0_1_0_db.py \
        tests/fixtures/graupel-0.1.0.db
"""
import sys

from graupel.data.api import init_default_configurations
from graupel.data.models import Location
from graupel.data.storage import Storage

storage = Storage(sys.argv[1])
configs = init_default_configurations(storage)
first = configs[0]
first.name = "Mein Alpenwetter"
first.location = Location(
    name="Garmisch-Partenkirchen", latitude=47.4917, longitude=11.0955,
    elevation=708,
)
storage.update(first)
own = configs[1].model_copy(deep=True)
own.id = None
own.name = "Eigene Kette"
own.location = Location(name="Hamburg", latitude=53.5511, longitude=9.9937)
own = storage.create(own)
ids = [c.id for c in storage.list_all()]
storage.reorder([own.id] + [i for i in ids if i != own.id])
for loc, times in (
    (Location(name="Offenbach am Main", latitude=50.0956, longitude=8.7761,
              elevation=98), 3),
    (Location(name="Wien", latitude=48.2082, longitude=16.3738), 1),
):
    for _ in range(times):
        storage.record_location_selection(loc)
storage.close()
