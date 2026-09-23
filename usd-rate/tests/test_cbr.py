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


def test_btc_api_is_integer_rubles() -> None:
    rate = Rate(
        code="BTC",
        name="₿",
        pair="BTC → RUB",
        unit="₽ за 1 биткоин",
        value=6_681_809.4,
        previous=6_512_000.0,
        date="15.09.2026",
        fetched_at="2026-09-14T21:00:00+03:00",
        source="test",
    )
    data = rate.to_api()
    assert data["display"] == "6 681 809"
    assert "млн" not in data["unit"]
    assert "dense" not in data
    assert "обновлено" not in data["meta"]
    assert "CoinGecko" in data["meta"]

def test_bundle_footer() -> None:
    from app.cbr import RatesBundle

    rate = Rate(
        code="USD",
        name="$",
        pair="USD → RUB",
        unit="₽",
        value=84.33,
        previous=84.0,
        date="15.09.2026",
        fetched_at="2026-09-14T21:00:00+03:00",
        source="test",
    )
    btc = Rate(
        code="BTC",
        name="₿",
        pair="BTC → RUB",
        unit="₽",
        value=6_000_000,
        previous=5_900_000,
        date="14.09.2026",
        fetched_at="2026-09-14T21:00:00+03:00",
        source="test",
    )
    bundle = RatesBundle(
        usd=rate, eur=rate, cny=rate, btc=btc,
        date="15.09.2026",
        fetched_at="2026-09-14T21:00:00+03:00",
    )
    footer = bundle.to_api()["footer"]
    assert footer["fiat"].startswith("USD EUR CNY · ЦБ РФ на ")
    assert footer["btc"].startswith("BTC · CoinGecko на ")
