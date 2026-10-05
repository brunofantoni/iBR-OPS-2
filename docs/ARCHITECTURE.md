# IBR Ops - Architecture & Phase 1 Execution

This document details the architectural blueprint of IBR Ops.

## 1. Context Diagram
```
[Technical Operator] --(HTTPS / WebSockets)--> [Vite + React SPA Frontend]
                                                      |
                                                      v
                                            [Express Backend API]
                                                      |
                   +----------------------------------+----------------------------------+
                   |                                  |                                  |
                   v                                  v                                  v
         [Policy Engine & RBAC]             [AI Provider Orchestrator]        [Knowledge Base & File Ingest]
                   |                                  |                                  |
                   v                                  v                                  v
         [Simulation Executor]               [Gemini / OpenAI SDK]               [Vector Embeddings (RAG)]
                   |                                                                     |
                   v                                                                     v
         [Database: MySQL Schema] <--------------------------------------------- [File Search]
```

## 2. Component Layout
- **Frontend SPA**: Written in React + TypeScript + Tailwind CSS. Designed to provide a high-fidelity, dual-pane layout as specified in **TELA OPERAÇÕES (Section 48)**:
  - Left Sidebar: Navigation & Contextual Client Picker / Asset Metadata.
  - Center Workspace: Conversation Stream, Real-time Diagnostic tool-calls, and Ingestion.
  - Right Sidebar: Incident details, Severity, Risk matrix, Action Approval board.
- **Backend Service (Express)**:
  - Multi-tenant architecture keyed on `client_id`.
  - Serves static SPA bundle + provides granular JSON APIs for DB entities, ingestions, configurations, audit logs, and diagnostic triggers.
  - In-Memory or file-based relational simulation representing MySQL 8 constraints flawlessly.
- **AI Orchestrator**:
  - Implements the `AIProvider` contract.
  - Uses the `@google/genai` TypeScript library on the server side to power structural tool calls, risk classification, and diagnostics safely.
- **Policy Engine**:
  - Enforces access control, matching user permission profiles against risk level mappings (LEVEL 0 - LEVEL 3).
  - Handles `EXECUTOR_MODE=simulation` behavior to prevent unintended infrastructure impacts during developmental testing.

## 3. Deployment Topology
- Standard full-stack production target: Linux Server running PM2 or Docker.
- Static React build served alongside Express endpoints.
- Single database credential representing MySQL 8 production instance.
