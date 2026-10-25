---
layout: home

hero:
  name: InsideApp
  text: PezzaliAPP
  tagline: Analisi locale e lecita di applicazioni e software propri o autorizzati, con CLI e server MCP.
  actions:
    - theme: brand
      text: Inizia
      link: https://github.com/pezzaliapp/InsideApp#installazione-locale
    - theme: alt
      text: GitHub
      link: https://github.com/pezzaliapp/InsideApp

features:
  - title: Analizza con Claude Code
    details: Il server MCP di progetto collega Claude Code a InsideApp; descrivi l'app o la funzionalità da capire e segui le prove.
    link: /mcp-prompts
  - title: Molti formati
    details: Eseguibili nativi, app JavaScript ed Electron, assembly .NET, pacchetti Android e altri artefatti.
    link: /cli
  - title: Conserva le prove
    details: L'analisi gira in locale e restituisce osservazioni, limiti ed elementi sconosciuti.
    link: /mcp-contracts
---

> Documentazione tecnica originale di REA (in inglese), valida anche per
> InsideApp. Dove compaiono `npx rea-agents`, `rea setup` o `rea update`, in
> InsideApp usa `./scripts/insideapp.sh` e il file `.mcp.json` di progetto
> (vedi il README). Hopper, IDA Pro e JEB sono esclusi da InsideApp.

## Choose a guide

| Task                                                | Guides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identify a desktop installation                     | [Runtime candidates, evidence and follow-up files](desktop-applications.md)                                                                                                                                                                                                                                                                                                                                                                                                             |
| Inspect native functions, references, or types      | [Native binaries](native-investigation.md), [Go metadata](go-binaries.md), [Rust dependencies](rust-binaries.md), [CPython pyc files](python-pyc.md), [PE certificates](pe-certificates.md), [PE imports](pe-imports.md), [PE TLS/load config](pe-load-config.md), [ELF notes](elf-notes.md), [Linux kernel modules](kernel-modules.md), [Apple IPS](apple-ips.md), [Erlang BEAM](erlang-beam.md), [offline ELF layout](binary-diagnostics.md), [recorded crashes](recorded-crashes.md) |
| Inspect native functions, references, or types      | [Native binaries](native-investigation.md), [Go metadata](go-binaries.md), [Rust dependencies](rust-binaries.md), [CPython pyc files](python-pyc.md), [PE certificates](pe-certificates.md), [PE imports](pe-imports.md), [PE TLS/load config](pe-load-config.md), [ELF notes](elf-notes.md), [Apple IPS](apple-ips.md), [Erlang BEAM](erlang-beam.md), [offline ELF layout](binary-diagnostics.md), [recorded crashes](recorded-crashes.md)                                            |
| Select a native provider or import format           | [Ghidra semantics](ghidra-provider.md), [Windows](windows-ghidra-p0.md), [DOS](ghidra-dos.md), [raw bytes](raw-binary.md), [GameCube DOL](ghidra-dol.md), [MIPS](ghidra-mips.md), [PSP](ghidra-psp.md), [NativeAOT](ghidra-nativeaot.md), [IDA](ida-provider.md), [Kuna](kuna-provider.md), [JEB](jeb-analysis.md)                                                                                                                                                                      |
| Analyze JavaScript or Electron artifacts            | [Static analysis](javascript-artifact-reconstruction.md), [tracing and comparisons](javascript-application-workflows.md), [application graph](javascript-application-graph.md), [source recovery](javascript-recovery.md)                                                                                                                                                                                                                                                               |
| Compare static JavaScript with runtime observations | [Runtime attribution](javascript-runtime-observation.md), [reconciliation](javascript-runtime-reconciliation.md), [Electron observation](electron-observation.md), [Electron fuses](electron-fuses.md)                                                                                                                                                                                                                                                                                  |
| Inspect assemblies, packages, or firmware           | [Godot PCK](godot-pck.md), [.NET](managed-code-analysis.md), [Python packages](python-packaged-applications.md), [Android](android-analysis.md), [APK signatures](apk-signature.md), [Apktool resources](apktool-resource-analysis.md), [ADB acquisition](adb-device-analysis.md), [Apple](apple-application-analysis.md), [Harmony](harmony-analysis.md), [firmware](firmware-analysis.md), [WASM](wasm-artifacts.md), [EVM](evm-bytecode.md)                                          |
| Observe or compare a browser scenario               | [CDP observation](browser-observation.md), [scenarios](browser-scenario-contract.md), [runtime evidence](web-runtime.md), [historical captures](web-network-captures.md)                                                                                                                                                                                                                                                                                                                |
| Serve recorded behavior as an agent environment     | [Agent environments](agent-environments.md)                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Trace captured website source                       | [Source locations](web-source-location.md), [module traces](website-module-trace.md), [script export](website-script-export.md)                                                                                                                                                                                                                                                                                                                                                         |
| Capture and compare a command                       | [Process capture](process-capture.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Use CLI/MCP and retain evidence                     | [CLI](cli.md), [MCP contracts](mcp-contracts.md), [agent prompts](mcp-prompts.md), [obligation ledgers](reconstruction-obligation-ledgers.md)                                                                                                                                                                                                                                                                                                                                           |

For development, use [testing](testing.md), [client verification](client-verification.md),
[tool design](tool-design.md), and [admission limits and recovery](design/limits-and-recovery.md).
[Reconstruction readiness](reconstruction-readiness.md) describes a development
conformance verifier. [The 6.2 migration](migration-6.2.md) records that release's
compatibility changes; [the roadmap](roadmap.md) tracks future work.
