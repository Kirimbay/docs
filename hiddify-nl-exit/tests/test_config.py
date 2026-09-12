from pathlib import Path

from hiddify_nl_exit.config import load_config, panel_by_host

ROOT = Path(__file__).resolve().parents[1]


def test_load_example_config() -> None:
    cfg = load_config(ROOT / "config.example.yaml")
    assert cfg.sweden[0].id == "se01"
    assert cfg.netherlands.mode == "no_reset"
    assert panel_by_host(cfg, "sub-se1.example.com") is cfg.sweden[0]
    assert panel_by_host(cfg, "unknown.example.com") is cfg.sweden[0]
