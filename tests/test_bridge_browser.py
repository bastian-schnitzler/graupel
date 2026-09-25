import pytest

import graupel.API as bridge


@pytest.mark.parametrize("url", [
    "https://www.openstreetmap.org/copyright",
    "http://viewfinderpanoramas.org",
    "https://creativecommons.org/licenses/by-sa/3.0/",
    "https://example.org:443/path?q=value#section",
])
def test_open_external_url_uses_default_browser(monkeypatch, url):
    opened = []
    monkeypatch.setattr(bridge.webbrowser, "open", lambda value: opened.append(value) or True)
    api = bridge.API(storage_path=":memory:")
    assert api.open_external_url(url) is True
    assert opened == [url]


@pytest.mark.parametrize("url", [
    None, 123, {}, "", "example.org", "//example.org", "/tmp/file",
    "file:///tmp/file", "javascript:alert(1)", "mailto:a@example.org",
    "https://", "http:///path", "https://example.org:bad",
    "https://example.org:99999", "https://[invalid",
    " https://example.org", "https://example.org/\ncommand",
    "https://user:password@example.org", "https://example.org\\path",
])
def test_open_external_url_rejects_invalid_values(monkeypatch, url):
    def unexpected_open(value):
        pytest.fail("Invalid URL reached browser")
    monkeypatch.setattr(bridge.webbrowser, "open", unexpected_open)
    assert bridge.API(storage_path=":memory:").open_external_url(url) is False


def test_open_external_url_reports_browser_failure(monkeypatch):
    api = bridge.API(storage_path=":memory:")
    monkeypatch.setattr(bridge.webbrowser, "open", lambda value: False)
    assert api.open_external_url("https://example.org") is False

    def fail(value):
        raise bridge.webbrowser.Error("Unavailable")
    monkeypatch.setattr(bridge.webbrowser, "open", fail)
    assert api.open_external_url("https://example.org") is False
