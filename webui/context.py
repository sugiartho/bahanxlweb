import contextvars
from pathlib import Path

# Project root dir
PROJECT_DIR = Path(__file__).resolve().parents[1]

# Current user directory context variable (used in WebUI multi-tenant requests)
current_user_dir = contextvars.ContextVar("current_user_dir", default=None)

def resolve_path(filename: str | Path) -> Path:
    """Resolve a filename relative to the current thread's user directory if set,
    otherwise relative to the project root.
    """
    path_obj = Path(filename)
    if path_obj.is_absolute():
        return path_obj

    udir = current_user_dir.get()
    if udir:
        # If the path already has a custom/default- prefix inside decoy_data, resolve properly
        # Note: the filename can be "decoy_data/decoy-..." or just "refresh-tokens.json"
        return Path(udir) / filename
    
    return PROJECT_DIR / filename
