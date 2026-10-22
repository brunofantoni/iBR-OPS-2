# IBR Ops - Changelog

All notable changes to the IBR Ops platform will be documented in this file.

## [1.1.0] - 2026-10-22
### Changed & Hardened
- **Eradication of Mockups:** Completely removed all fake clients, canned proxy cards, synthetic incident logs, and mock runbooks. The application now exclusively operates against real data stored in MySQL 8 (`web008.ibrcloud.com.br / ibrops_aiops`).
- **Real Network Diagnostics:** Replaced mock execution returns with live Node.js network probes (`net.Socket` TCP port tests, `dns.promises.lookup` DNS resolution, and `fetch` HTTP status/latency probes).
- **Interactive Full CRUD Management:** Added real-time creation and deletion modals for Clients, Assets, Incidents, Knowledge Base documents, and Topology Relationships directly persisted to MySQL 8.
- **Radar Deployment Script:** Added `/scripts/deploy_web040_radar.sh` for automated deployment, systemd service configuration, and zero-downtime updates of the telemetry radar daemon on host `web040`.
- **Zero Secrets Hardcoded:** Verified that all sensitive credentials strictly use environment variables (`.env` or system environment).
