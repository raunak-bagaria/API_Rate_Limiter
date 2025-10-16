import csv
import os
import logging
from typing import Dict, Optional

"""
APIKeyManager: Handles API key validation using a CSV file for client data.

IMPORTANT NOTES FOR DEVELOPERS:
- Do not configure logging here. Logging should be configured in the main application (app.py)
- clients.csv must have headers: api_key,client_name,classification
- API keys are sensitive data - avoid logging them
- If clients.csv changes, server needs restart or call reload_clients()
"""

class APIKeyManager:
    def __init__(self, key_file: str = "clients.csv"):
        """
        Initialize APIKeyManager.
        Args:
            key_file (str): Path to CSV file containing client data (relative to this file)
        """
        self.key_file = os.path.join(os.path.dirname(__file__), key_file)
        self.clients = self._load_clients()

    def _load_clients(self) -> Dict[str, Dict[str, str]]:
        """
        Load client data from CSV file into a dictionary.
        Returns:
            Dict[str, Dict[str, str]]: Dictionary mapping API keys to client data
        """
        clients: Dict[str, Dict[str, str]] = {}
        try:
            with open(self.key_file, mode='r') as file:
                reader = csv.DictReader(file)
                if not {'api_key', 'client_name', 'classification'}.issubset(reader.fieldnames or []):
                    logging.error("Required columns missing in clients.csv")
                    return clients
                
                for row in reader:
                    api_key = row["api_key"]
                    clients[api_key] = {
                        "client_name": row["client_name"],
                        "classification": row["classification"]
                    }
        except FileNotFoundError:
            logging.error("clients.csv not found - API validation will fail")
        except Exception as e:
            logging.error(f"Error reading clients.csv: {str(e)}")
        return clients

    def validate_key(self, api_key: str) -> dict:
        """Validate the provided API key."""
        if api_key in self.clients:
            client_data = self.clients[api_key]
            return {
                "valid": True,
                "client_name": client_data["client_name"],
                "classification": client_data["classification"]
            }
        else:
            return {"valid": False, "error": {"message": "Invalid API Key"}}
