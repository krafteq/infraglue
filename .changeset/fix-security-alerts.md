---
'@krafteq/infraglue': minor
---

- Add environment variable interpolation in ig.yaml configs
- Add root-level vars and fix Pulumi secret output handling
- Fix: pass --secret flag when injecting Pulumi secret values
- Fix: resolve destroy crashes, stale locks, and add --approve-all support
- Fix: avoid pnpm wrapper in bin/ig.js to prevent .npmrc warnings
- Fix: resolve Dependabot security alerts and harden CI workflow permissions
