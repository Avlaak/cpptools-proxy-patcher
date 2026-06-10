# C/C++ Tools Proxy Patcher

An explicit, reversible local patcher for Microsoft C/C++ Tools.

This extension installs [`cpptools-proxy`](https://github.com/matu6968/cpptools-proxy) in front of the Microsoft C/C++ language server by replacing the local `cpptools` launcher inside the installed `ms-vscode.cpptools` extension. The proxy rewrites the LSP `initialize` request `clientInfo.name` to `Visual Studio Code` before forwarding messages to the original language server.

## Why

Recent Microsoft C/C++ Tools builds check the LSP client name and may exit when used from VS Code forks. `cpptools-proxy` is a small LSP proxy intended to keep the Microsoft C/C++ language server usable in those environments when the user has installed Microsoft C/C++ Tools locally.

## Commands

- `C/C++ Tools Proxy: Patch C/C++ Tools Proxy`
- `C/C++ Tools Proxy: Restore C/C++ Tools`
- `C/C++ Tools Proxy: Show C/C++ Tools Proxy Status`
- `C/C++ Tools Proxy: Refresh C/C++ Tools Proxy Status`
- `C/C++ Tools Proxy: Check for Updates`

## Settings

- `CpptoolsProxyPatcher.autoCheckUpdates` (default: `true`) — automatically check for extension updates on startup.

The extension also shows a status bar item:

- `Not installed`: `ms-vscode.cpptools` was not found.
- `Available`: C/C++ Tools is installed and currently unpatched.
- `Patched`: `cpptools-proxy` is installed.
- `Broken`: expected files or hashes do not match the patch marker.

## Safety Model

- No automatic patching.
- No runtime downloads of `cpptools-proxy` binaries; they are bundled in the extension package.
- Extension updates may be downloaded from GitHub releases when you use **Check for Updates** or when automatic update checks are enabled.
- No Microsoft binaries are redistributed.
- Patch and restore require explicit user confirmation.
- A marker file is written next to the launcher so restore can avoid deleting unknown files.
- The bundled proxy binary is verified against `SHA256SUMS` before use.

## Bundled Proxy Targets

`cpptools-proxy` binaries are not meant to be committed to this repository. During packaging, `npm run prepare-proxy-assets` downloads pinned release artifacts from `cpptools-proxy` `1.0.0`, verifies their SHA-256 hashes, and writes them under `resources/cpptools-proxy`.

The packaging script currently prepares:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm`
- `linux-arm64`
- `linux-ia32`
- `linux-x64`
- `win32-arm64`
- `win32-ia32`
- `win32-x64`

If your platform is not included, the patch command will stop with a clear error and will not modify C/C++ Tools.

## Packaging

```sh
npm install
npm run vsix
```

For Open VSX:

```sh
npm run openvsx:package
npm run openvsx:publish -- --pat <token>
```

## Notes

This is a local compatibility patch. Microsoft C/C++ Tools remains Microsoft's runtime, and its license still applies to Microsoft binaries. Review the Microsoft C/C++ Tools license and the [`cpptools-proxy`](https://github.com/matu6968/cpptools-proxy) project before using this extension.
