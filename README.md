# API Rate Limiter

**Project ID:** P73  
**Course:** UE23CS341A  
**Academic Year:** 2025  
**Semester:** 5th Sem  
**Campus:** RR  
**Branch:** CSE  
**Section:** H  
**Team:** Codevengers

## 📋 Project Description

A middleware or service that can be used to enforce rate limits on API endpoints to prevent abuse.

This repository contains the source code and documentation for the API Rate Limiter project, developed as part of the UE23CS341A course at PES University.

## 🧑‍💻 Development Team (Codevengers)

- [@raunak-bagaria](https://github.com/raunak-bagaria) - Scrum Master
- [@TOOISH12](https://github.com/TOOISH12) - Developer Team
- [@roshit87sharma](https://github.com/roshit87sharma) - Developer Team
- [@jeev1234](https://github.com/jeev1234) - Developer Team

## 👨‍🏫 Teaching Assistant

- [@BlackADer-0069](https://github.com/BlackADer-0069)
- [@Abhigna-D](https://github.com/Abhigna-D)
- [@MDAzeemDhalayat](https://github.com/MDAzeemDhalayat)


## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn package manager

### Installation
1. Clone the repository
   ```bash
   git clone https://github.com/pestechnology/PESU_RR_CSE_H_P73_API_Rate_Limiter_Codevengers.git
   cd PESU_RR_CSE_H_P73_API_Rate_Limiter_Codevengers
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Run the application
   ```bash
   # Development mode (with auto-restart)
   npm run dev
   
   # Production mode
   npm start
   ```

4. Run tests
   ```bash
   npm test
   ```

## 📁 Project Structure

```
PESU_RR_CSE_H_P73_API_Rate_Limiter_Codevengers/
├── src/                 # Source code
│   ├── app.js          # Main application entry point
│   ├── clientIdentifier.js    # Client identification logic
│   ├── apiKeyManager.js       # API key validation
│   ├── ipManager.js           # IP learning and CIDR management
│   ├── ipAllowBlockManager.js # IP allowlist/blocklist management
│   ├── errorMessageManager.js # Custom error message management
│   ├── clients.csv            # API key client configurations
│   ├── client_cidr.csv        # Preconfigured CIDR ranges
│   ├── client_ips.csv         # Learned IP addresses
│   ├── ip_allowlist.csv       # Allowlisted IPs and CIDR ranges
│   ├── ip_blocklist.csv       # Blocklisted IPs and CIDR ranges
│   └── error_messages.csv     # Custom error message templates
├── docs/               # Documentation
│   ├── ERROR_MESSAGES.md      # Custom error messages documentation
│   └── ...
├── tests/              # Test files
│   ├── apiKeyManager.test.js
│   ├── ipManager.test.js
│   ├── ipAllowBlockManager.test.js
│   ├── errorMessageManager.test.js
│   └── ...
├── .github/            # GitHub workflows and templates
├── README.md          # This file
└── ...
```

## 🔒 Security Features

### Custom Error Messages

The API Rate Limiter supports configurable custom error messages for blocked and rate-limited responses:

#### Features
- **Configurable per Block Type**: Different messages for rate limits, IP blocklists, unauthorized access, and tier restrictions
- **Template Variables**: Dynamic variable substitution (e.g., `{{clientName}}`, `{{retryAfter}}`, `{{contactEmail}}`)
- **Default Messages**: Fallback to sensible defaults if custom messages are not configured
- **Hot Reload**: Update messages without restarting the service
- **Admin API**: Manage messages through REST endpoints

For detailed documentation, see [Custom Error Messages Documentation](docs/ERROR_MESSAGES.md).

### IP Allowlists and Blocklists

The API Rate Limiter includes comprehensive IP allowlist and blocklist functionality:

#### Features
- **Allowlisted IPs**: IPs that are processed according to normal rules
- **Blocklisted IPs**: IPs that are immediately rejected with HTTP 403
- **CIDR Range Support**: Both individual IPs and CIDR ranges are supported
- **IPv4 and IPv6**: Full support for both IP versions
- **Priority Handling**: Blocklist takes precedence over allowlist
- **Request Tracking**: Automatic counting of requests from listed IPs

#### Configuration Files

**IP Allowlist (`src/ip_allowlist.csv`)**:
```csv
ip_or_cidr,description,added_date,request_count
192.168.100.0/24,Trusted internal network,2025-10-18T10:00:00Z,0
10.0.0.50,Admin workstation,2025-10-18T10:00:00Z,0
```

**IP Blocklist (`src/ip_blocklist.csv`)**:
```csv
ip_or_cidr,description,added_date,request_count
192.168.1.100,Compromised host,2025-10-18T10:00:00Z,0
10.0.0.0/8,Internal network - blocked for testing,2025-10-18T10:00:00Z,0
```

#### Admin API Endpoints

- `POST /admin/allowlist/add` - Add IP/CIDR to allowlist
- `POST /admin/blocklist/add` - Add IP/CIDR to blocklist
- `DELETE /admin/allowlist/remove` - Remove IP/CIDR from allowlist
- `DELETE /admin/blocklist/remove` - Remove IP/CIDR from blocklist
- `GET /admin/stats` - Get statistics including IP list data
- `POST /admin/reload` - Reload all configurations including IP lists

#### Example Usage

**Adding to blocklist:**
```bash
curl -X POST http://localhost:3000/admin/blocklist/add \
  -H "Content-Type: application/json" \
  -d '{"ip_or_cidr": "203.0.113.0/24", "description": "Malicious IP range"}'
```

**Testing blocked IP:**
```bash
curl -H "X-API-Key: 12345-ABCDE" \
     -H "X-Forwarded-For: 192.168.1.100" \
     http://localhost:3000/data
# Returns HTTP 403 Forbidden
```

## 🛠️ Development Guidelines

### Branching Strategy
- `main`: Production-ready code
- `develop`: Development branch
- `feature/*`: Feature branches
- `bugfix/*`: Bug fix branches

### Commit Messages
Follow conventional commit format:
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `style:` Code style changes
- `refactor:` Code refactoring
- `test:` Test-related changes

### Code Review Process
1. Create feature branch from `develop`
2. Make changes and commit
3. Create Pull Request to `develop`
4. Request review from team members
5. Merge after approval

## Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## License

This project is developed for educational purposes as part of the PES University UE23CS341A curriculum.

---
This project was originally developed in a private university GitHub organization with full PR-based workflow and code reviews. The repository was later mirrored here with permission.

**Course:** UE23CS341A  
**Institution:** PES University  
**Academic Year:** 2025  
**Semester:** 5th Sem
