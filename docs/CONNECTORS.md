# IBR Ops - Connector Framework Specification

This file describes the extensible Connector interface and planned integrations.

## 1. Unified Interface Class
All operational connectors implement the canonical TypeScript signature:
```typescript
interface Connector {
  connect(): Promise<boolean>;
  healthCheck(): Promise<boolean>;
  getCapabilities(): string[];
  executeReadAction(action: string, params: Record<string, any>): Promise<any>;
  executeApprovedAction(action: string, params: Record<string, any>, signature: string): Promise<any>;
}
```

## 2. Planned Connector Implementations
- **pfSense**: Retrieve live firewall gateway lists, active OpenVPN tunnels, and IPSec connectivity states. (Read-only initially).
- **Proxmox Virtual Environment**: Inspect nodes, active guest hypervisors, and dynamic hardware resource exhaustion.
- **SSH / Bash Executor**: Executes controlled, high-integrity script commands without allowing arbitrary command injection.
