---
'@krafteq/infraglue': patch
---

fix: replace exec() with streaming spawn in provider execCommand to eliminate maxBuffer crashes on large Pulumi/Terraform output
