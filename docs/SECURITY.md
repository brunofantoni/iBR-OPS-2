# IBR Ops - Security Architecture & Policy Engine

This document outlines the security controls, secrets isolation, and RBAC rules for IBR Ops.

## 1. Role-Based Access Control (RBAC)
- **ADMIN**: Complete system control, secret updates, connector provisioning, and manual validation of LEVEL 3 actions.
- **TECHNICIAN**: Incident management, runbook access, query permissions, execution of LEVEL 0 diagnostics, and request submissions for elevated approvals.
- **VIEWER**: Read-only access to client rosters, knowledge entries, and high-level health dashboards.

## 2. Policy Engine Evaluation Workflow
Every tool call, remote session request, or query passes through our central Policy Engine:
$$\text{Verdict} = f(\text{User Role}, \text{Resource Owner}, \text{Action Risk Level}, \text{Approval Status})$$

Where risk categories are defined as:
- **LEVEL 0**: Purely read-only diagnostics (e.g. ping, systemctl status, disk check). Hashed stdout, sanitization of secrets.
- **LEVEL 1**: Previously authorized non-destructive adjustments.
- **LEVEL 2**: Service restarts or diagnostic exports requiring prompt tech verification.
- **LEVEL 3**: Disruptive modifications (firewall rules, routing changes, destructive MySQL modifications). Requires Admin authorization.

## 3. Secret Reference Protocol
To safeguard operational secrets (IPSec tunnel credentials, SSH Private Keys, pfSense API tokens):
- Secrets are NEVER sent to the LLM.
- Plaintext secrets are substituted with unique handles (e.g. `[REDACTED_SECRET:PROXMOX_PROD]`).
- Environment variables or vault indices are resolved exclusively at the transport boundary within the backend connectors.
