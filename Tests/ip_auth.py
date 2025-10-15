import ipaddress

# Define CIDR ranges per client
CLIENT_CIDRS = {
    "ClientA": ["192.168.0.0/24", "10.0.0.0/8"],
    "ClientB": ["172.16.0.0/16", "2001:db8::/32"],
}

def identify_client_by_ip(ip_address: str):
    ip = ipaddress.ip_address(ip_address)
    for client, cidrs in CLIENT_CIDRS.items():
        for cidr in cidrs:
            if ip in ipaddress.ip_network(cidr):
                return {"client_name": client, "matched_cidr": cidr}
    raise ValueError("IP not found in any CIDR range")