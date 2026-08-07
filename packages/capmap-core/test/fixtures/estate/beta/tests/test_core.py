import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from beta_service.core import Settings, run  # noqa: E402


def test_run_returns_doubled_port() -> None:
    assert run(Settings(8080)) == 16160
