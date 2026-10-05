# IBR Ops - Changelog

All notable changes to the IBR Ops platform will be documented in this file.

## [1.0.0] - 2026-10-05
### Added
- Phase 1 core implementation:
  - Relational database schema with client, asset, knowledge base, repository, and incident structures.
  - Granular RBAC supporting Admin, Technician, and Viewer user types.
  - Multi-source Ingestion engine with automatic PII/Secret sanitization (`[REDACTED_SECRET]`) and asset discovery recommendation mapping.
  - Real-time technical cockpit (Tela Operações) with a triple-pane workspace.
  - Dynamic AI Operational agent powered by Google Gemini SDK configured via environment endpoints.
  - Fully simulated execution engine (`EXECUTOR_MODE=simulation`) for LEVEL 0 health checks.
  - Immutable system audit logging preventing technician tempering.
