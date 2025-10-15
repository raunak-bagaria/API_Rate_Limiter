# api_auth.py

VALID_API_KEYS = {
    "12345-ABCDE": {"client_name": "ClientA", "class": "premium"},
    "98765-ZYXWV": {"client_name": "ClientB", "class": "standard"},
}

def identify_client(api_key):
    if api_key in VALID_API_KEYS:
        return VALID_API_KEYS[api_key]
    else:
        raise ValueError("Invalid API key")