from flask import Flask, request, jsonify
from api_key_manager import APIKeyManager
import logging
import logging.handlers
import os

"""
API Rate Limiter Application

IMPORTANT NOTES FOR DEVELOPERS:
- Configure logging here, not in imported modules
- API keys should never be logged
- Update clients.csv and restart server or call key_manager.reload_clients()
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

# Initialize API key manager
key_manager = APIKeyManager()

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

if __name__ == "__main__":
    app.run(debug=True)
