#!/usr/bin/env python3
"""Generate golden crypto vectors from Python reference implementation."""
from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path
from unittest import mock

PROJECT_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_DIR))

TEST_SECRETS = {
    "XDATA_KEY": "0123456789abcdef0123456789abcdef",
    "AX_API_SIG_KEY": "0123456789abcdef0123456789abcdef",
    "X_API_BASE_SECRET": "x-api-base-secret-test-value",
    "ENCRYPTED_FIELD_KEY": "0123456789abcdef0123456789abcdef",
    "AX_FP_KEY": "0123456789abcdef0123456789abcdef",
}

os.environ.update(TEST_SECRETS)

import app.service.crypto_helper as ch  # noqa: E402
importlib.reload(ch)

from app.client.encrypt import DeviceInfo, ax_fingerprint, build_encrypted_field  # noqa: E402

FIXED_IV_HEX = "aabbccddeeff0011"
DEVICE = DeviceInfo(
    manufacturer="samsung",
    model="SM-N935F",
    lang="en",
    resolution="720x1540",
    tz_short="GMT07:00",
    ip="192.169.69.69",
    font_scale=1.0,
    android_release="13",
    msisdn="6281398370564",
)


def main() -> int:
    xtime = 1710000000123
    plaintext = '{"hello":"world","n":42}'
    encrypted_xdata = ch.encrypt_xdata(plaintext, xtime)
    decrypted_xdata = ch.decrypt_xdata(encrypted_xdata, xtime)

    with mock.patch("os.urandom", return_value=bytes.fromhex(FIXED_IV_HEX)):
        circle_enc = ch.encrypt_circle_msisdn("6281234567890")

    vectors = {
        "secrets": TEST_SECRETS,
        "cases": [
            {
                "name": "encrypt_xdata",
                "input": {"plaintext": plaintext, "xtime_ms": xtime},
                "output": encrypted_xdata,
            },
            {
                "name": "decrypt_xdata",
                "input": {"xdata": encrypted_xdata, "xtime_ms": xtime},
                "output": decrypted_xdata,
            },
            {
                "name": "make_x_signature",
                "input": {
                    "id_token": "id-token-sample",
                    "method": "POST",
                    "path": "api/v8/profile",
                    "sig_time_sec": 1710000000,
                },
                "output": ch.make_x_signature("id-token-sample", "POST", "api/v8/profile", 1710000000),
            },
            {
                "name": "make_x_signature_payment",
                "input": {
                    "access_token": "access-token",
                    "sig_time_sec": 1710000001,
                    "package_code": "PKG001",
                    "token_payment": "tok-pay",
                    "payment_method": "BALANCE",
                    "payment_for": "MYSELF",
                    "path": "api/v8/payment/settlement",
                },
                "output": ch.make_x_signature_payment(
                    "access-token", 1710000001, "PKG001", "tok-pay", "BALANCE", "MYSELF", "api/v8/payment/settlement"
                ),
            },
            {
                "name": "make_ax_api_signature",
                "input": {
                    "ts_for_sign": "2026-06-13T10:00:00+07:00",
                    "contact": "6281234567890",
                    "code": "123456",
                    "contact_type": "SMS",
                },
                "output": ch.make_ax_api_signature(
                    "2026-06-13T10:00:00+07:00", "6281234567890", "123456", "SMS"
                ),
            },
            {
                "name": "make_x_signature_bounty",
                "input": {
                    "access_token": "access-token",
                    "sig_time_sec": 1710000002,
                    "package_code": "BOUNTY1",
                    "token_payment": "tok-bounty",
                },
                "output": ch.make_x_signature_bounty("access-token", 1710000002, "BOUNTY1", "tok-bounty"),
            },
            {
                "name": "make_x_signature_loyalty",
                "input": {
                    "sig_time_sec": 1710000003,
                    "package_code": "LOYAL1",
                    "token_confirmation": "tok-confirm",
                    "path": "api/v8/loyalty/redeem",
                },
                "output": ch.make_x_signature_loyalty(1710000003, "LOYAL1", "tok-confirm", "api/v8/loyalty/redeem"),
            },
            {
                "name": "make_x_signature_bounty_allotment",
                "input": {
                    "sig_time_sec": 1710000004,
                    "package_code": "ALLOT1",
                    "token_confirmation": "tok-allot",
                    "path": "api/v8/bounty/allotment",
                    "destination_msisdn": "6289988776655",
                },
                "output": ch.make_x_signature_bounty_allotment(
                    1710000004, "ALLOT1", "tok-allot", "api/v8/bounty/allotment", "6289988776655"
                ),
            },
            {
                "name": "make_x_signature_basic",
                "input": {"method": "GET", "path": "api/v8/public", "sig_time_sec": 1710000005},
                "output": ch.make_x_signature_basic("GET", "api/v8/public", 1710000005),
            },
            {
                "name": "encrypt_circle_msisdn",
                "input": {"msisdn": "6281234567890", "iv_hex16": FIXED_IV_HEX},
                "output": circle_enc,
            },
            {
                "name": "decrypt_circle_msisdn",
                "input": {"encrypted": circle_enc},
                "output": ch.decrypt_circle_msisdn(circle_enc),
            },
            {
                "name": "ax_fingerprint",
                "input": {"device": DEVICE.__dict__},
                "output": ax_fingerprint(DEVICE, TEST_SECRETS["AX_FP_KEY"]),
            },
            {
                "name": "build_encrypted_field",
                "input": {"iv_hex16": FIXED_IV_HEX, "urlsafe_b64": False},
                "output": build_encrypted_field(FIXED_IV_HEX, urlsafe_b64=False),
            },
            {
                "name": "build_encrypted_field_urlsafe",
                "input": {"iv_hex16": FIXED_IV_HEX, "urlsafe_b64": True},
                "output": build_encrypted_field(FIXED_IV_HEX, urlsafe_b64=True),
            },
        ],
    }

    out = Path(__file__).resolve().parent / "vectors.json"
    out.write_text(json.dumps(vectors, indent=2), encoding="utf-8")
    print(f"Wrote {len(vectors['cases'])} vectors to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())