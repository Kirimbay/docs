"""Smoke-тесты форматирования курса (без сети)."""

from __future__ import annotations

from app.cbr import UsdRate, _format_delta, _format_rub


def test_format_rub() -> None:
    assert _format_rub(84.3363) == "84,34"
    assert _format_rub(100.0) == "100,00"


def test_format_delta() -> None:
    assert _format_delta(0.12) == "+0,12"
    assert _format_delta(-0.45) == "-0,45"
    assert _format_delta(0.0) == "0,00"


def test_usd_rate_api_shape() -> None:
    rate = UsdRate(
        value=84.33,
        previous=84.0,
        nominal=1,
        date="14.09.2026",
        fetched_at="2026-09-14T21:00:00+03:00",
        source="test",
    )
    data = rate.to_api()
    assert data["display"] == "84,33"
    assert data["delta"] == 0.33
    assert data["delta_display"].startswith("+")
