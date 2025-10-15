from flask import Flask, request, jsonify
from api_key_manager import APIKeyManager
from ip_manager import IPManager
import logging
import logging.handlers
import os

"""
API Rate Limiter Application

IMPORTANT NOTES FOR DEVELOPERS:
- Configure logging here, not in imported modules
- API keys should never be logged
- Update clients.csv and restart server or call key_manager.reload_clients()
- Update ip_clients.csv and restart server or call ip_manager.reload_clients()
- All responses follow the format: {"error": {"message": str}} for errors
                                 {"message": str, "classification": str} for success
"""

app = Flask(__name__)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),  # Console output
        logging.handlers.RotatingFileHandler(
            'api.log',  # Log file name
            maxBytes=1024*1024,   # 1MB
            backupCount=5         # Keep 5 backup files
        )
    ]
)

# Initialize API key manager and IP manager
key_manager = APIKeyManager()
ip_manager = IPManager()

@app.route("/data", methods=["GET"])
def get_data():
    """Handle GET requests to /data endpoint with API key validation."""
    api_key = request.headers.get("x-api-key")

    if not api_key:
        logging.warning("Request received without API key")
        return jsonify({"error": {"message": "API key missing"}}), 400

    result = key_manager.validate_key(api_key)

    if not result["valid"]:
        logging.info("Invalid API key attempt")  # Don't log the actual key
        return jsonify(result), 401  # Unauthorized

    logging.info(f"Successful request for client: {result['client_name']}")
    return jsonify({
        "message": f"Welcome {result['client_name']}",
        "classification": result["classification"]
    }), 200

@app.route("/ip-data", methods=["GET"])
def get_ip_data():
    """Handle GET requests to /ip-data endpoint with IP-based validation."""
    # Get client IP address
    # Check X-Forwarded-For header first (for proxy/load balancer scenarios)
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    
    # If X-Forwarded-For contains multiple IPs, take the first one
    if client_ip and ',' in client_ip:
        client_ip = client_ip.split(',')[0].strip()
    
    if not client_ip:
        logging.warning("Could not determine client IP address")
        return jsonify({"error": {"message": "Could not determine client IP"}}), 400

    result = ip_manager.validate_ip(client_ip)

    if not result["valid"]:
        logging.info(f"Unauthorized IP address attempt: {client_ip}")
        return jsonify(result), 403  # Forbidden

    logging.info(f"Successful IP-based request for client: {result['client_name']} from {client_ip}")
    return jsonify({
        "message": f"Welcome {result['client_name']}",
        "classification": result["classification"],
        "matched_cidr": result["matched_cidr"],
        "client_ip": client_ip
    }), 200

if __name__ == "__main__":
    app.run(debug=True)
