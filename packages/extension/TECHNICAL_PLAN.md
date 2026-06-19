# Historical Technical Plan

This file is historical context only. It described an earlier toolbar-removal and controller-testing sidepanel direction.

The live extension no longer matches that plan:

- There is no toolbar entrypoint.
- The command palette is the extension popup.
- The sidepanel is unified and currently exposes Mobile Scanner and Offer Calculator.
- Controller testing is not a configured manifest command and is not part of the current sidepanel tool registry.

For the current extension shape, use:

- [README.md](README.md)
- [docs/CMDK_README.md](docs/CMDK_README.md)
- [src/lib/sidepanel-tools.ts](src/lib/sidepanel-tools.ts)
- [wxt.config.ts](wxt.config.ts)
