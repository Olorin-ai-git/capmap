"""Core behaviour of the beta fixture service."""


class Settings:
    """Runtime settings resolved from the environment."""

    def __init__(self, port: int) -> None:
        self.port = port


def _private_helper(value: int) -> int:
    return value * 2


def run(settings: Settings) -> int:
    """Start the service and return the bound port."""
    return _private_helper(settings.port)
