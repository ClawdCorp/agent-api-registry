# rbac + tenancy v1 (cc-136)

## scope
- workspace
- member
- role (owner/admin/dev/viewer)
- invitation flow
- middleware role checks on protected endpoints

## role matrix
- owner: full control, billing, role management, delete workspace
- admin: member management, project/policy management
- dev: create/update agent projects, run broker calls
- viewer: read-only dashboards and logs

## acceptance checks
- protected endpoints reject missing workspace context
- protected endpoints reject insufficient role
- invite accept flow creates membership with selected role
- cross-workspace access is denied by default
