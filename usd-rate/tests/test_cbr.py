"""Smoke-тесты форматирования курсов (без сети)."""

from __future__ import annotations

from app.cbr import Rate, _format_delta, _format_rub


def test_format_rub() -> None:
    assert _format_rub(84.3363) == "84,34"
    assert _format_rub(100.0) == "100,00"
    assert _format_rub(7_654_321.9, digits=0) == "7 654 322"


def test_format_delta() -> None:
    assert _format_delta(0.12) == "+0,12"
    assert _format_delta(-0.45) == "-0,45"
    assert _format_delta(0.0) == "0,00"
    assert _format_delta(-1200, digits=0) == "-1 200"


def test_format_mln() -> None:
    from app.cbr import _format_mln, _format_mln_delta

    assert _format_mln(6_681_809) == "6,68"
    assert _format_mln_delta(169_087) == "+0,17"
    assert _format_mln_delta(-50_000) == "-0,05"


def test_rate_api_shape() -> None:
    rate = Rate(
        code="USD",
        name="Доллар США",
        pair="USD → RUB",
        unit="₽ за 1 доллар США",
        value=84.33,
        previous=84.0,
        date="14.09.2026",
        fetched_at="2026-09-14T21:00:00+03:00",
        source="test",
    )
    data = rate.to_api()
    assert data["display"] == "84,33"
    assert data["delta"] == 0.33
    assert data["delta_display"].startswith("+")
