
"""Load and manage SPICE kernels for physics engine."""

from pathlib import Path
import spiceypy as spice


SPICE_KERNELS = [
    "naif0012.tls",
    "de440s.bsp",
    "moon_pa_de440_200625.bpc",
    "moon_de440_250416.tf",
]

_loaded_kernels = set()


def load_kernels(kernel_dir: str | Path) -> None:

    """Load SPICE kernels."""

    directory = Path(kernel_dir).expanduser().resolve()

    if not directory.is_dir():
        raise FileNotFoundError(
            f"Kernel directory not found: {directory}"
        )

    kernel_paths = [
        directory / filename
        for filename in SPICE_KERNELS
    ]

    missing = [
        path.name for path in kernel_paths
        if not path.is_file()
    ]

    if missing:
        raise FileNotFoundError(
            f"Missing SPICE kernels: {missing}"
        )

    for path in kernel_paths:
        if path not in _loaded_kernels:
            spice.furnsh(str(path))
            _loaded_kernels.add(path)

    print(f"Successfully loaded {len(_loaded_kernels)} SPICE kernels.")


def get_loaded_kernel_count() -> int:
    """Return the number of currently loaded SPICE kernels."""
    return spice.ktotal("ALL")


def clear_kernels() -> None:
    """Unload all SPICE kernels."""
    spice.kclear()
    _loaded_kernels.clear()