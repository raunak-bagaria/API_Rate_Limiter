import pytest
from ip_auth import identify_client_by_ip

def test_ipv4_valid_match():
    result = identify_client_by_ip("192.168.0.45")
    assert result["client_name"] == "ClientA"
    assert "192.168.0.0/24" in result["matched_cidr"]

def test_ipv6_valid_match():
    result = identify_client_by_ip("2001:db8::1")
    assert result["client_name"] == "ClientB"
    assert result["matched_cidr"] == "2001:db8::/32"

def test_multiple_cidrs_for_client():
    result = identify_client_by_ip("10.0.10.10")
    assert result["client_name"] == "ClientA"
    assert result["matched_cidr"] == "10.0.0.0/8"

def test_no_match():
    with pytest.raises(ValueError) as exc_info:
        identify_client_by_ip("8.8.8.8")
    assert str(exc_info.value) == "IP not found in any CIDR range"

def test_boundary_ip():
    result = identify_client_by_ip("192.168.0.0")  # first IP in CIDR
    assert result["client_name"] == "ClientA"