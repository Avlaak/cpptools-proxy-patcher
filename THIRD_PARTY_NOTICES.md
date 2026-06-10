# Third Party Notices

## cpptools-proxy

This extension package bundles release artifacts from:

- Project: <https://github.com/matu6968/cpptools-proxy>
- Release: <https://github.com/matu6968/cpptools-proxy/releases/tag/1.0.0>

The proxy is a minimal LSP proxy for Microsoft C/C++ Tools. It rewrites the LSP `initialize` request client name before forwarding messages to the original language server.

The repository stores the pinned download manifest in `scripts/prepare-proxy-assets.js`. The binary files are downloaded and hash-verified during packaging.

## Microsoft C/C++ Tools

This extension does not redistribute Microsoft C/C++ Tools or any Microsoft binaries. It only modifies a locally installed `ms-vscode.cpptools` extension after explicit user confirmation. Microsoft C/C++ Tools remains governed by Microsoft's own license terms.
