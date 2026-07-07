---
'@krafteq/infraglue': patch
---

Fail fast when Pulumi stack selection reports backend, network, or auth errors, and only auto-create a new stack when Pulumi explicitly reports that the requested stack is missing. Plain Pulumi stderr is now surfaced in provider errors so stack-selection failures are visible without verbose output.
