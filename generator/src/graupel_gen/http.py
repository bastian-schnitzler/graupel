# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""HTTP helpers: User-Agent and a rate limit shared by all requests.

Open-Meteo is free for non-commercial use within a daily quota; the
generator stays at no more than `DEFAULT_RATE` requests per second.
"""

from __future__ import annotations

import asyncio
import threading
import time
from typing import Optional

from . import __version__

USER_AGENT = (
    f"graupel-gen/{__version__} "
    "(+https://github.com/bastian-schnitzler/graupel)"
)
DEFAULT_RATE = 8.0  # requests per second
HEADERS = {"User-Agent": USER_AGENT}


class RateLimiter:
    """Spaces requests at least 1 / rate seconds apart (threads and tasks).

    A rate of 0 or None turns the limit off (tests).
    """

    def __init__(self, rate: Optional[float] = DEFAULT_RATE):
        self.interval = 1.0 / rate if rate else 0.0
        self._lock = threading.Lock()
        self._next = 0.0

    def _reserve(self) -> float:
        if not self.interval:
            return 0.0
        with self._lock:
            now = time.monotonic()
            slot = max(now, self._next)
            self._next = slot + self.interval
            return slot - now

    def wait(self) -> None:
        delay = self._reserve()
        if delay > 0:
            time.sleep(delay)

    async def async_wait(self) -> None:
        delay = self._reserve()
        if delay > 0:
            await asyncio.sleep(delay)
