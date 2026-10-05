# IBR Ops - Canonical MySQL Schema Specification

This document details the MySQL 8 schema design designed for full relational consistency.

## Schema Diagram (Conceptual)
```
       +-------------------+               +------------------+
       |      clients      | <-----------+ |      assets      |
       +-------------------+               +------------------+
                 ^                                  ^
                 |                                  |
                 |                                  v
       +-------------------+               +------------------+
       |     incidents     |               | relationships/   |
       +-------------------+               | dependencies     |
                 ^                         +------------------+
                 |
                 v
       +-------------------+
       |     audit_logs    |
       +-------------------+
```

## Relational Constraints
- Foreign keys with `ON DELETE RESTRICT` or `ON DELETE CASCADE` appropriately.
- Soft-delete status tracks archived resources without losing auditability.
- Multi-column index layouts on `client_id`, `status`, and `severity` query indices.
- Primary index identifiers generated using ULIDs or auto-incrementing bigints.
