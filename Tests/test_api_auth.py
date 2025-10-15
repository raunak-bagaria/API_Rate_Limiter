# test_api_auth.py
import pytest
from api_auth import identify_client

def test_valid_api_key():
    result = identify_client("12345-ABCDE")
    assert result["client_name"] == "ClientA"
    assert result["class"] == "premium"

def test_invalid_api_key():
    with pytest.raises(ValueError) as exc_info:
        identify_client("00000-INVALID")
    assert str(exc_info.value) == "Invalid API key"

def test_client_classification_data():
    result = identify_client("98765-ZYXWV")
    assert "class" in result
    assert result["class"] == "standard"