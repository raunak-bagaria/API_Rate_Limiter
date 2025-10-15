

import csv
import os
import logging
import ipaddress
from typing import Dict, List, Optional

"""
IPManager: Handles IP-based client identification using CIDR ranges.

IMPORTANT NOTES FOR DEVELOPERS:
- Do not configure logging here. Logging should be configured in the main application (app.py)
- ip_clients.csv must have headers: client_name,classification,cidr_ranges
- Supports both IPv4 and IPv6 addresses
- Multiple CIDR ranges can be specified per client (comma-separated)
- If ip_clients.csv changes, server needs restart or call reload_clients()
"""

class IPManager:
    def __init__(self, ip_file: str = "ip_clients.csv"):
        """
        Initialize IPManager.
        Args:
            ip_file (str): Path to CSV file containing client IP data (relative to this file)
        """
        self.ip_file = os.path.join(os.path.dirname(__file__), ip_file)
        self.clients = self._load_clients()

    def _load_clients(self) -> List[Dict]:
        """
        Load client data from CSV file into a list of dictionaries.
        Each entry contains client info and parsed CIDR network objects.
        
        Returns:
            List[Dict]: List of client configurations with parsed CIDR ranges
        """
        clients: List[Dict] = []
        try:
            with open(self.ip_file, mode='r') as file:
                reader = csv.DictReader(file)
                if not {'client_name', 'classification', 'cidr_ranges'}.issubset(reader.fieldnames or []):
                    logging.error("Required columns missing in ip_clients.csv")
                    return clients
                
                for row in reader:
                    # Parse CIDR ranges (comma-separated)
                    cidr_strings = [cidr.strip() for cidr in row["cidr_ranges"].split(',')]
                    networks = []
                    
                    for cidr in cidr_strings:
                        try:
                            # This handles both IPv4 and IPv6
                            network = ipaddress.ip_network(cidr, strict=False)
                            networks.append(network)
                        except ValueError as e:
                            logging.warning(f"Invalid CIDR range '{cidr}' for client {row['client_name']}: {str(e)}")
                    
                    if networks:  # Only add clients with valid CIDR ranges
                        clients.append({
                            "client_name": row["client_name"],
                            "classification": row["classification"],
                            "networks": networks
                        })
        except FileNotFoundError:
            logging.error("ip_clients.csv not found - IP validation will fail")
        except Exception as e:
            logging.error(f"Error reading ip_clients.csv: {str(e)}")
        return clients

    def validate_ip(self, ip_address: str) -> dict:
        """
        Validate the provided IP address against configured CIDR ranges.
        
        Args:
            ip_address (str): IP address to validate (IPv4 or IPv6)
            
        Returns:
            dict: Validation result with client data or error
        """
        try:
            # Parse the IP address (handles both IPv4 and IPv6)
            ip = ipaddress.ip_address(ip_address)
            
            # Check against all client CIDR ranges
            for client in self.clients:
                for network in client["networks"]:
                    if ip in network:
                        return {
                            "valid": True,
                            "client_name": client["client_name"],
                            "classification": client["classification"],
                            "matched_cidr": str(network)
                        }
            
            # No match found
            return {
                "valid": False,
                "error": {"message": "IP address not authorized"}
            }
            
        except ValueError:
            return {
                "valid": False,
                "error": {"message": "Invalid IP address format"}
            }

    def reload_clients(self):
        """Reload client data from CSV file."""
        self.clients = self._load_clients()
        logging.info("IP clients configuration reloaded")
