import logging
import os
import time
import traceback
from datetime import datetime
from html import escape

logger = logging.getLogger("webui")

def format_rp(value) -> str:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return str(value or "-")
    return "Rp " + f"{n:,}".replace(",", ".")

def format_ts(ts) -> str:
    if not ts:
        return "-"
    try:
        return datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(ts)

_ID_MONTHS_LONG = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
]

def format_date(ts) -> str:
    if not ts:
        return "-"
    try:
        from zoneinfo import ZoneInfo
        dt = datetime.fromtimestamp(int(ts), tz=ZoneInfo("Asia/Jakarta"))
        return f"{dt.day} {_ID_MONTHS_LONG[dt.month - 1]} {dt.year}"
    except Exception:
        return str(ts)

def format_iso_date(iso_str) -> str:
    """Convert ISO-8601 string '2026-05-28T04:30:32.000+00:00' to human readable '28 May 2026, 11:30'"""
    if not iso_str:
        return "-"
    try:
        # Menghapus timezone marker belakang karena fromisoformat di versi python < 3.11 sensitif
        clean_str = iso_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean_str)
        # Offset ke WIB (UTC+7)
        import datetime as dt_lib
        dt = dt.astimezone(dt_lib.timezone(dt_lib.timedelta(hours=7)))
        
        months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"]
        return f"{dt.day} {months[dt.month-1]} {dt.year}, {dt.strftime('%H:%M')} WIB"
    except Exception:
        return str(iso_str)

def safe_html(text) -> str:
    if text is None:
        return ""
    return escape(str(text))


def public_error_message(exc: Exception, *, context: str = "") -> str:
    """Log full exception server-side; return a safe message for the browser.
    Also appends to webui-errors.log (project root) for post-mortem even if console not visible.
    """
    tb = traceback.format_exc()
    if context:
        logger.error("Request error [%s]: %s\n%s", context, exc, tb)
    else:
        logger.error("Unhandled error: %s\n%s", exc, tb)
    # Persistent log
    try:
        from pathlib import Path
        log_path = Path(__file__).resolve().parents[1] / "webui-errors.log"
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {context or 'no-ctx'}: {exc}\n{tb}\n---\n")
    except Exception:
        pass
    debug = os.getenv("WEBUI_DEBUG", "").strip().lower() in ("1", "true", "yes")
    if debug:
        return f"Internal error: {exc}\n\n{tb}"
    return "Terjadi kesalahan internal. Silakan coba lagi atau hubungi admin jika masalah berlanjut."

def humanize_bytes(n) -> str:
    try:
        n = int(n)
    except (TypeError, ValueError):
        return "-"
    units = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    f = float(n)
    while f >= 1024 and i < len(units) - 1:
        f /= 1024
        i += 1
    return f"{f:.2f} {units[i]}"


def format_data_quota_compact(n) -> str:
    """Compact DATA quota label (e.g. 6 GB) from raw bytes."""
    from app.menus.util import format_quota_byte

    s = format_quota_byte(int(n or 0))
    for unit in (" GB", " MB", " KB"):
        if s.endswith(unit):
            num = float(s[: -len(unit)])
            if unit == " GB":
                return f"{int(num)} GB" if num == int(num) else f"{num:g} GB"
            return s
    return s


def format_benefit_quota_pair(benefit: dict) -> tuple[str, str]:
    """Return (total_display, remaining_display) from quota-details benefit row."""
    if benefit.get("is_unlimited"):
        return "Unlimited", "Unlimited"

    dt = (benefit.get("data_type") or "").upper()
    try:
        rem = int(benefit.get("remaining") or 0)
        tot = int(benefit.get("total") or 0)
    except (TypeError, ValueError):
        rem, tot = 0, 0

    if dt == "DATA":
        return format_data_quota_compact(tot), format_data_quota_compact(rem)
    if dt == "VOICE":
        return f"{tot / 60:.0f} Minutes", f"{rem / 60:.0f} Minutes"
    if dt == "TEXT":
        return str(tot), str(rem)
    return str(tot), str(rem)
