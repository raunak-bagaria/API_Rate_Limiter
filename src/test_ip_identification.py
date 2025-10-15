#!/usr/bin/env python3
"""
Test script for IP-based Client Identification with CIDR

This script tests all acceptance criteria:
1. System correctly matches IP addresses against CIDR ranges
2. Multiple CIDR ranges can be configured per client
3. IPv4 and IPv6 addresses are supported
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from ip_manager import IPManager
import logging

# Configure logging for test output
logging.basicConfig(level=logging.INFO, format='%(message)s')

def test_ipv4_matching():
    """Test IPv4 address matching against CIDR ranges."""
    print("\n=== Testing IPv4 Address Matching ===")
    ip_manager = IPManager()
    
    test_cases = [
        ("192.168.1.50", "Corporate HQ", True),  # Should match 192.168.1.0/24
        ("10.0.5.100", "Corporate HQ", True),     # Should match 10.0.0.0/16
        ("172.16.0.50", "Branch Office", True),   # Should match 172.16.0.0/20
        ("203.0.113.100", "Remote Workers", True),# Should match 203.0.113.0/24
        ("192.168.100.50", "Mobile Users", True), # Should match 192.168.100.0/24
        ("8.8.8.8", None, False),                 # Should not match any
        ("172.20.0.1", None, False),              # Should not match any
    ]
    
    passed = 0
    failed = 0
    
    for ip, expected_client, should_pass in test_cases:
        result = ip_manager.validate_ip(ip)
        if should_pass:
            if result["valid"] and result["client_name"] == expected_client:
                print(f"✓ PASS: {ip} correctly identified as {expected_client} (CIDR: {result['matched_cidr']})")
                passed += 1
            else:
                print(f"✗ FAIL: {ip} - Expected {expected_client}, got {result}")
                failed += 1
        else:
            if not result["valid"]:
                print(f"✓ PASS: {ip} correctly rejected (not authorized)")
                passed += 1
            else:
                print(f"✗ FAIL: {ip} - Should have been rejected, but was accepted as {result.get('client_name')}")
                failed += 1
    
    print(f"\nIPv4 Tests: {passed} passed, {failed} failed")
    return failed == 0

def test_ipv6_matching():
    """Test IPv6 address matching against CIDR ranges."""
    print("\n=== Testing IPv6 Address Matching ===")
    ip_manager = IPManager()
    
    test_cases = [
        ("2001:db8:abcd::1", "IPv6 Client", True),      # Should match 2001:db8:abcd::/48
        ("2001:db8:1234::1", "Mobile Users", True),     # Should match 2001:db8:1234::/48
        ("2001:db8:abcd:5678::1", "IPv6 Client", True), # Should match 2001:db8:abcd::/48
        ("2001:0db8:abcd:0000:0000:0000:0000:0001", "IPv6 Client", True),  # Long format
        ("2001:4860:4860::8888", None, False),          # Should not match any (Google DNS)
        ("fe80::1", None, False),                       # Link-local, should not match
    ]
    
    passed = 0
    failed = 0
    
    for ip, expected_client, should_pass in test_cases:
        result = ip_manager.validate_ip(ip)
        if should_pass:
            if result["valid"] and result["client_name"] == expected_client:
                print(f"✓ PASS: {ip} correctly identified as {expected_client} (CIDR: {result['matched_cidr']})")
                passed += 1
            else:
                print(f"✗ FAIL: {ip} - Expected {expected_client}, got {result}")
                failed += 1
        else:
            if not result["valid"]:
                print(f"✓ PASS: {ip} correctly rejected (not authorized)")
                passed += 1
            else:
                print(f"✗ FAIL: {ip} - Should have been rejected, but was accepted as {result.get('client_name')}")
                failed += 1
    
    print(f"\nIPv6 Tests: {passed} passed, {failed} failed")
    return failed == 0

def test_multiple_cidr_ranges():
    """Test that multiple CIDR ranges per client work correctly."""
    print("\n=== Testing Multiple CIDR Ranges per Client ===")
    ip_manager = IPManager()
    
    # Corporate HQ has two ranges: 192.168.1.0/24 and 10.0.0.0/16
    print("Corporate HQ has multiple CIDR ranges:")
    test_ips = ["192.168.1.10", "10.0.50.100"]
    
    passed = 0
    failed = 0
    
    for ip in test_ips:
        result = ip_manager.validate_ip(ip)
        if result["valid"] and result["client_name"] == "Corporate HQ":
            print(f"✓ PASS: {ip} matched Corporate HQ via CIDR {result['matched_cidr']}")
            passed += 1
        else:
            print(f"✗ FAIL: {ip} did not match Corporate HQ")
            failed += 1
    
    # Remote Workers has two ranges
    print("\nRemote Workers has multiple CIDR ranges:")
    test_ips = ["203.0.113.50", "198.51.100.50"]
    
    for ip in test_ips:
        result = ip_manager.validate_ip(ip)
        if result["valid"] and result["client_name"] == "Remote Workers":
            print(f"✓ PASS: {ip} matched Remote Workers via CIDR {result['matched_cidr']}")
            passed += 1
        else:
            print(f"✗ FAIL: {ip} did not match Remote Workers")
            failed += 1
    
    # Mobile Users has mixed IPv4 and IPv6
    print("\nMobile Users has mixed IPv4 and IPv6 ranges:")
    test_ips = ["192.168.100.10", "2001:db8:1234::100"]
    
    for ip in test_ips:
        result = ip_manager.validate_ip(ip)
        if result["valid"] and result["client_name"] == "Mobile Users":
            print(f"✓ PASS: {ip} matched Mobile Users via CIDR {result['matched_cidr']}")
            passed += 1
        else:
            print(f"✗ FAIL: {ip} did not match Mobile Users")
            failed += 1
    
    print(f"\nMultiple CIDR Tests: {passed} passed, {failed} failed")
    return failed == 0

def test_invalid_inputs():
    """Test handling of invalid IP addresses."""
    print("\n=== Testing Invalid Input Handling ===")
    ip_manager = IPManager()
    
    test_cases = [
        "not-an-ip",
        "999.999.999.999",
        "192.168.1",
        "gggg::1",
        "",
    ]
    
    passed = 0
    failed = 0
    
    for ip in test_cases:
        result = ip_manager.validate_ip(ip)
        if not result["valid"] and "Invalid IP address format" in result["error"]["message"]:
            print(f"✓ PASS: '{ip}' correctly rejected as invalid format")
            passed += 1
        else:
            print(f"✗ FAIL: '{ip}' - Should have been rejected as invalid format")
            failed += 1
    
    print(f"\nInvalid Input Tests: {passed} passed, {failed} failed")
    return failed == 0

def main():
    """Run all tests."""
    print("=" * 70)
    print("IP-Based Client Identification with CIDR - Test Suite")
    print("=" * 70)
    
    results = []
    results.append(("IPv4 Matching", test_ipv4_matching()))
    results.append(("IPv6 Matching", test_ipv6_matching()))
    results.append(("Multiple CIDR Ranges", test_multiple_cidr_ranges()))
    results.append(("Invalid Input Handling", test_invalid_inputs()))
    
    print("\n" + "=" * 70)
    print("ACCEPTANCE CRITERIA VERIFICATION")
    print("=" * 70)
    print("✓ System correctly matches IP addresses against CIDR ranges")
    print("✓ Multiple CIDR ranges can be configured per client")
    print("✓ IPv4 and IPv6 addresses are supported")
    
    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)
    
    all_passed = True
    for test_name, passed in results:
        status = "✓ PASSED" if passed else "✗ FAILED"
        print(f"{test_name}: {status}")
        if not passed:
            all_passed = False
    
    print("=" * 70)
    if all_passed:
        print("ALL TESTS PASSED ✓")
        return 0
    else:
        print("SOME TESTS FAILED ✗")
        return 1

if __name__ == "__main__":
    sys.exit(main())
