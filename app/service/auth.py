import json
import time
from app.client.ciam import get_new_token
from app.client.engsel import get_profile
from app.util import ensure_api_key
from webui.storage.backend import USER_ACTIVE_NUMBER, USER_REFRESH_TOKENS
from webui.storage.tenant import (
    delete_user_blob,
    read_user_json,
    read_user_text,
    user_blob_exists,
    write_user_json,
    write_user_text,
)

class Auth:
    _instance_ = None
    _initialized_ = False

    api_key = ""

    refresh_tokens = []
    # Format of refresh_tokens:
    # [
        # {
            # "number": int,
            # "subscriber_id": str,
            # "subscription_type": str,
            # "refresh_token": str
        # }
    # ]

    active_user = None
    # {
    #     "number": int,
    #     "subscriber_id": str,
    #     "subscription_type": str,
    #     "tokens": {
    #         "refresh_token": str,
    #         "access_token": str,
    #         "id_token": str
	#     }
    # }
    
    last_refresh_time = None
    
    def __new__(cls, *args, **kwargs):
        if not cls._instance_:
            cls._instance_ = super().__new__(cls)
        return cls._instance_
    
    def __init__(self):
        if not self._initialized_:
            self.api_key = ensure_api_key()
            self.reload_for_current_dir()
            self._initialized_ = True

    def reload_for_current_dir(self):
        """Reset state and re-read tokens/active-user for the current storage tenant."""
        self.refresh_tokens = []
        self.active_user = None
        if user_blob_exists(USER_REFRESH_TOKENS):
            try:
                self.load_tokens()
            except Exception as e:
                print(f"[auth.reload] load_tokens err: {e}")
        else:
            write_user_json(USER_REFRESH_TOKENS, [])
        try:
            self.load_active_number()
        except Exception as e:
            print(f"[auth.reload] load_active_number err: {e}")
        self.last_refresh_time = int(time.time())
            
    def load_tokens(self):
        refresh_tokens = read_user_json(USER_REFRESH_TOKENS, default=[])
        if not isinstance(refresh_tokens, list):
            refresh_tokens = []

        if len(refresh_tokens) != 0:
            self.refresh_tokens = []

        for rt in refresh_tokens:
            if "number" in rt and "refresh_token" in rt:
                self.refresh_tokens.append(rt)
            else:
                print(f"Invalid token entry: {rt}")

    def add_refresh_token(self, number: int, refresh_token: str):
        existing = next((rt for rt in self.refresh_tokens if rt["number"] == number), None)
        if existing:
            existing["refresh_token"] = refresh_token
        else:
            tokens = get_new_token(self.api_key, refresh_token, "")
            profile_data = get_profile(self.api_key, tokens["access_token"], tokens["id_token"]) or {}
            profile = profile_data.get("profile") or {}
            sub_id = profile.get("subscriber_id") or ""
            sub_type = profile.get("subscription_type") or "PREPAID"

            self.refresh_tokens.append({
                "number": int(number),
                "subscriber_id": sub_id,
                "subscription_type": sub_type,
                "refresh_token": refresh_token
            })
        
        self.write_tokens_to_file()
        self.set_active_user(number)
            
    def remove_refresh_token(self, number: int):
        self.refresh_tokens = [rt for rt in self.refresh_tokens if rt["number"] != number]
        self.write_tokens_to_file()
        
        if self.active_user and self.active_user["number"] == number:
            self.active_user = None
            if len(self.refresh_tokens) != 0:
                first_rt = self.refresh_tokens[0]
                try:
                    tokens = get_new_token(self.api_key, first_rt["refresh_token"], first_rt.get("subscriber_id", ""))
                    if tokens:
                        self.set_active_user(first_rt["number"])
                except Exception as e:
                    print(f"Failed to activate next after remove {number}: {e}")
            else:
                print("No users left.")
                if user_blob_exists(USER_ACTIVE_NUMBER):
                    try:
                        delete_user_blob(USER_ACTIVE_NUMBER)
                    except Exception:
                        pass

    def set_active_user(self, number: int):
        rt_entry = next((rt for rt in self.refresh_tokens if rt["number"] == number), None)
        if not rt_entry:
            print(f"No refresh token found for number: {number}")
            return False

        try:
            tokens = get_new_token(self.api_key, rt_entry["refresh_token"], rt_entry.get("subscriber_id", ""))
            if not tokens:
                print(f"Failed to get tokens for number: {number}. The refresh token might be invalid or expired.")
                self.remove_refresh_token(number)
                return False

            profile_data = get_profile(self.api_key, tokens["access_token"], tokens["id_token"]) or {}
            profile = profile_data.get("profile") or {}
            subscriber_id = profile.get("subscriber_id") or rt_entry.get("subscriber_id", "")
            subscription_type = profile.get("subscription_type") or rt_entry.get("subscription_type", "PREPAID")

            self.active_user = {
                "number": int(number),
                "subscriber_id": subscriber_id,
                "subscription_type": subscription_type,
                "tokens": tokens
            }
            
            rt_entry["subscriber_id"] = subscriber_id
            rt_entry["subscription_type"] = subscription_type
            rt_entry["refresh_token"] = tokens["refresh_token"]
            self.write_tokens_to_file()
            
            self.last_refresh_time = int(time.time())
            self.write_active_number()
            return True
        except Exception as e:
            err = str(e)
            print(f"Error activating number {number}: {err}")
            if any(kw in err.lower() for kw in ["invalid or expired", "session not active", "subscriber id is missing", "refresh token"]):
                print(f"Auto-removing invalid token for {number}")
                self.remove_refresh_token(number)
            if self.active_user and self.active_user.get("number") == number:
                self.active_user = None
            return False

    def renew_active_user_token(self):
        if self.active_user:
            try:
                tokens = get_new_token(self.api_key, self.active_user["tokens"]["refresh_token"], self.active_user.get("subscriber_id", ""))
                if tokens:
                    self.active_user["tokens"] = tokens
                    self.last_refresh_time = int(time.time())
                    self.add_refresh_token(self.active_user["number"], self.active_user["tokens"]["refresh_token"])
                    
                    print("Active user token renewed successfully.")
                    return True
                else:
                    print("Failed to renew active user token.")
                    num = self.active_user.get("number")
                    if num:
                        self.remove_refresh_token(num)
                    self.active_user = None
            except Exception as e:
                print(f"Renew error: {e}")
                num = self.active_user.get("number") if self.active_user else None
                if num and any(kw in str(e).lower() for kw in ["invalid", "expired", "session not active"]):
                    self.remove_refresh_token(num)
                self.active_user = None
        else:
            print("No active user set or missing refresh token.")
        return False
    
    def get_active_user(self):
        if not self.active_user:
            for rt in list(self.refresh_tokens):
                try:
                    tokens = get_new_token(self.api_key, rt["refresh_token"], rt.get("subscriber_id", ""))
                    if tokens:
                        if self.set_active_user(rt["number"]):
                            break
                except Exception as e:
                    print(f"Bootstrap get_new failed for {rt.get('number')}: {e}")
                    self.remove_refresh_token(rt["number"])
            if not self.active_user:
                return None
        
        if self.last_refresh_time is None or (int(time.time()) - self.last_refresh_time) > 300:
            try:
                self.renew_active_user_token()
            except Exception as e:
                print(f"Renew failed: {e}")
                if self.active_user:
                    num = self.active_user.get("number")
                    try:
                        get_new_token(self.api_key, self.active_user["tokens"]["refresh_token"], self.active_user.get("subscriber_id", ""))
                    except Exception:
                        if num:
                            self.remove_refresh_token(num)
                        self.active_user = None
            self.last_refresh_time = time.time()
        
        return self.active_user
    
    def get_active_tokens(self) -> dict | None:
        active_user = self.get_active_user()
        return active_user["tokens"] if active_user else None
    
    def write_tokens_to_file(self):
        write_user_json(USER_REFRESH_TOKENS, self.refresh_tokens)
    
    def write_active_number(self):
        if self.active_user:
            write_user_text(USER_ACTIVE_NUMBER, str(self.active_user["number"]))
        else:
            if user_blob_exists(USER_ACTIVE_NUMBER):
                delete_user_blob(USER_ACTIVE_NUMBER)
    
    def load_active_number(self):
        if not user_blob_exists(USER_ACTIVE_NUMBER):
            return
        number_str = (read_user_text(USER_ACTIVE_NUMBER) or "").strip()
        if number_str.isdigit():
            number = int(number_str)
            success = self.set_active_user(number)
            if not success:
                try:
                    if user_blob_exists(USER_ACTIVE_NUMBER):
                        delete_user_blob(USER_ACTIVE_NUMBER)
                except Exception:
                    pass
                self.active_user = None

AuthInstance = Auth()