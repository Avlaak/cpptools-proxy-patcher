import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';

const CPPTOOLS_EXTENSION_ID = 'ms-vscode.cpptools';
const MARKER_SCHEMA = 1;
const PATCHED_BY = 'cpptools-proxy-patcher';
const PROXY_SOURCE = 'matu6968/cpptools-proxy 1.0.0 bundled artifact';

export type CpptoolsProxyStatus =
    | { kind: 'not-installed' }
    | { kind: 'available'; extensionPath: string; cpptoolsPath: string }
    | { kind: 'patched'; extensionPath: string; cpptoolsPath: string; originalPath: string }
    | { kind: 'broken'; extensionPath: string; reason: string };

export interface CpptoolsProxyRecoveryInfo {
    canRestore: boolean;
    reason: string;
    currentSha256?: string;
    expectedProxySha256?: string;
}

interface CpptoolsInstall {
    extension: vscode.Extension<unknown>;
    binDir: string;
    binName: string;
    cpptoolsPath: string;
    originalPath: string;
    disabledPath: string;
    markerPath: string;
}

interface CpptoolsProxyMarker {
    schema: number;
    patchedBy: string;
    patchedAt: string;
    cpptoolsExtensionVersion: string;
    platform: NodeJS.Platform;
    arch: NodeJS.Architecture;
    originalPath: string;
    originalSha256: string;
    proxySha256: string;
    proxySource: string;
}

interface BundledProxy {
    proxyPath: string;
    proxySha256: string;
    proxySource: string;
}

export async function getCpptoolsProxyStatus(): Promise<CpptoolsProxyStatus> {
    const install = resolveCpptools();

    if (!install) {
        return { kind: 'not-installed' };
    }

    const markerExists = await pathExists(install.markerPath);
    const originalExists = await pathExists(install.originalPath);
    const cpptoolsExists = await pathExists(install.cpptoolsPath);

    if (markerExists) {
        const marker = await readMarkerSafely(install.markerPath);

        if (!marker) {
            return broken(install, 'Patch marker exists but cannot be read or has an invalid format.');
        }

        const markerProblem = validateMarker(marker, install);
        if (markerProblem) {
            return broken(install, markerProblem);
        }

        if (!originalExists) {
            return broken(install, `Original launcher is missing: ${install.originalPath}`);
        }

        if (!cpptoolsExists) {
            return broken(install, `Patched launcher is missing: ${install.cpptoolsPath}`);
        }

        let currentSha256: string;
        try {
            currentSha256 = await sha256(install.cpptoolsPath);
        } catch (err) {
            return broken(install, `Cannot hash patched launcher: ${getCpptoolsProxyErrorMessage(err)}`);
        }

        if (currentSha256 !== marker.proxySha256) {
            return broken(
                install,
                `Patched launcher hash mismatch. Expected ${marker.proxySha256}, got ${currentSha256}.`
            );
        }

        return {
            kind: 'patched',
            extensionPath: install.extension.extensionPath,
            cpptoolsPath: install.cpptoolsPath,
            originalPath: install.originalPath
        };
    }

    if (originalExists) {
        return broken(
            install,
            `Backup launcher exists without a patch marker: ${install.originalPath}. Resolve it manually before patching.`
        );
    }

    if (!cpptoolsExists) {
        return broken(install, `C/C++ Tools launcher is missing: ${install.cpptoolsPath}`);
    }

    return {
        kind: 'available',
        extensionPath: install.extension.extensionPath,
        cpptoolsPath: install.cpptoolsPath
    };
}

export async function getCpptoolsProxyRecoveryInfo(): Promise<CpptoolsProxyRecoveryInfo> {
    const install = resolveCpptools();

    if (!install) {
        return {
            canRestore: false,
            reason: 'ms-vscode.cpptools is not installed.'
        };
    }

    const marker = await readMarkerSafely(install.markerPath);
    if (!marker) {
        return {
            canRestore: false,
            reason: 'Patch marker is missing or invalid.'
        };
    }

    if (!(await pathExists(install.originalPath))) {
        return {
            canRestore: false,
            reason: `Original launcher is missing: ${install.originalPath}`
        };
    }

    let currentSha256: string | undefined;
    try {
        currentSha256 = await pathExists(install.cpptoolsPath)
            ? await sha256(install.cpptoolsPath)
            : undefined;
    } catch {
        currentSha256 = undefined;
    }

    return {
        canRestore: true,
        reason: currentSha256 && currentSha256 !== marker.proxySha256
            ? `Current launcher hash mismatch. Expected ${marker.proxySha256}, got ${currentSha256}.`
            : 'Original launcher can be restored from the saved backup.',
        currentSha256,
        expectedProxySha256: marker.proxySha256
    };
}

export async function preflightCpptoolsProxyPatch(context: vscode.ExtensionContext): Promise<void> {
    const status = await getCpptoolsProxyStatus();
    if (status.kind !== 'available') {
        throw new Error(`C/C++ Tools Proxy cannot be patched from current status: ${getCpptoolsProxyStatusLabel(status)}.`);
    }

    const install = resolveCpptoolsOrThrow();
    await resolveBundledProxy(context, install.binName);

    if (await pathExists(install.markerPath)) {
        throw new Error('Patch marker already exists. Refresh status before patching again.');
    }

    if (await pathExists(install.originalPath)) {
        throw new Error(`Backup launcher already exists: ${install.originalPath}`);
    }
}

export async function patchCpptoolsProxy(context: vscode.ExtensionContext): Promise<void> {
    await preflightCpptoolsProxyPatch(context);
    const install = resolveCpptoolsOrThrow();
    const proxy = await resolveBundledProxy(context, install.binName);

    const originalSha256 = await sha256(install.cpptoolsPath);
    const tempProxyPath = path.join(install.binDir, `${install.binName}.cpptools-proxy.${Date.now()}.tmp`);

    const marker: CpptoolsProxyMarker = {
        schema: MARKER_SCHEMA,
        patchedBy: PATCHED_BY,
        patchedAt: new Date().toISOString(),
        cpptoolsExtensionVersion: getExtensionVersion(install.extension),
        platform: process.platform,
        arch: process.arch,
        originalPath: install.originalPath,
        originalSha256,
        proxySha256: proxy.proxySha256,
        proxySource: proxy.proxySource
    };

    await fs.copyFile(proxy.proxyPath, tempProxyPath);
    await chmodExecutableIfNeeded(tempProxyPath);

    try {
        await fs.rename(install.cpptoolsPath, install.originalPath);
        await chmodExecutableIfNeeded(install.originalPath);

        try {
            await fs.rename(tempProxyPath, install.cpptoolsPath);
        } catch (err) {
            await rollbackOriginalRename(install);
            throw err;
        }

        await fs.writeFile(install.markerPath, `${JSON.stringify(marker, null, 2)}\n`, { flag: 'wx' });
    } catch (err) {
        await removeTempFile(tempProxyPath);
        throw err;
    }
}

export async function restoreCpptoolsProxy(recovery: boolean): Promise<void> {
    const install = resolveCpptoolsOrThrow();
    const marker = await readMarkerOrThrow(install.markerPath);

    if (!(await pathExists(install.originalPath))) {
        throw new Error(`Original launcher is missing: ${install.originalPath}`);
    }

    const cpptoolsExists = await pathExists(install.cpptoolsPath);
    if (!recovery) {
        if (!cpptoolsExists) {
            throw new Error(`Patched launcher is missing: ${install.cpptoolsPath}`);
        }

        const currentSha256 = await sha256(install.cpptoolsPath);
        if (currentSha256 !== marker.proxySha256) {
            throw new Error(
                `Patched launcher hash mismatch. Expected ${marker.proxySha256}, got ${currentSha256}.`
            );
        }
    }

    if (cpptoolsExists) {
        if (await pathExists(install.disabledPath)) {
            throw new Error(`Disabled proxy backup already exists: ${install.disabledPath}`);
        }

        await fs.rename(install.cpptoolsPath, install.disabledPath);
    }

    try {
        await fs.rename(install.originalPath, install.cpptoolsPath);
        await chmodExecutableIfNeeded(install.cpptoolsPath);
    } catch (err) {
        await rollbackDisabledRename(install, cpptoolsExists);
        throw err;
    }

    await fs.unlink(install.markerPath);

    if (!recovery && cpptoolsExists) {
        await removeTempFile(install.disabledPath);
    }
}

export function getCpptoolsProxyStatusLabel(status: CpptoolsProxyStatus): string {
    switch (status.kind) {
        case 'not-installed':
            return 'Not installed';
        case 'available':
            return 'Available';
        case 'patched':
            return 'Patched';
        case 'broken':
            return 'Broken';
    }
}

export function getCpptoolsProxyStatusMessage(status: CpptoolsProxyStatus): string {
    switch (status.kind) {
        case 'not-installed':
            return 'C/C++ Tools Proxy: ms-vscode.cpptools is not installed.';
        case 'available':
            return `C/C++ Tools Proxy: Available. Launcher: ${status.cpptoolsPath}`;
        case 'patched':
            return `C/C++ Tools Proxy: Patched. Original launcher: ${status.originalPath}`;
        case 'broken':
            return `C/C++ Tools Proxy: Broken. ${status.reason}`;
    }
}

export function getCpptoolsProxyErrorMessage(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);

    if (isNodeError(err) && (err.code === 'EPERM' || err.code === 'EBUSY')) {
        return `${message}. Close C/C++ language server activity, reload the window, or restart the editor, then retry.`;
    }

    if (isNodeError(err) && err.code === 'EACCES') {
        return `${message}. The editor does not have permission to modify the C/C++ Tools extension directory.`;
    }

    return message;
}

async function sha256(filePath: string): Promise<string> {
    const data = await fs.readFile(filePath);
    return createHash('sha256').update(data).digest('hex');
}

function resolveCpptools(): CpptoolsInstall | undefined {
    const extension = vscode.extensions.getExtension(CPPTOOLS_EXTENSION_ID);
    if (!extension) {
        return undefined;
    }

    const binName = process.platform === 'win32' ? 'cpptools.exe' : 'cpptools';
    const originalName = process.platform === 'win32' ? 'cpptools-orig.exe' : 'cpptools-orig';
    const disabledName = process.platform === 'win32' ? 'cpptools-proxy-disabled.exe' : 'cpptools-proxy-disabled';
    const binDir = path.join(extension.extensionPath, 'bin');

    return {
        extension,
        binDir,
        binName,
        cpptoolsPath: path.join(binDir, binName),
        originalPath: path.join(binDir, originalName),
        disabledPath: path.join(binDir, disabledName),
        markerPath: path.join(binDir, '.cpptools-proxy.json')
    };
}

function resolveCpptoolsOrThrow(): CpptoolsInstall {
    const install = resolveCpptools();
    if (!install) {
        throw new Error('ms-vscode.cpptools is not installed.');
    }

    return install;
}

async function resolveBundledProxy(context: vscode.ExtensionContext, binName: string): Promise<BundledProxy> {
    const target = `${process.platform}-${process.arch}`;
    const proxyDir = context.asAbsolutePath(path.join('resources', 'cpptools-proxy', target));
    const proxyPath = path.join(proxyDir, binName);
    const sumsPath = path.join(proxyDir, 'SHA256SUMS');

    if (!(await pathExists(proxyPath))) {
        throw new Error(`Bundled cpptools-proxy is missing for ${target}: ${proxyPath}`);
    }

    if (!(await pathExists(sumsPath))) {
        throw new Error(`Bundled cpptools-proxy SHA256SUMS is missing for ${target}: ${sumsPath}`);
    }

    const expectedSha256 = parseExpectedSha256(await fs.readFile(sumsPath, 'utf8'), binName);
    if (!expectedSha256) {
        throw new Error(`SHA256SUMS does not contain an entry for ${binName}.`);
    }

    const actualSha256 = await sha256(proxyPath);
    if (actualSha256 !== expectedSha256) {
        throw new Error(`Bundled cpptools-proxy hash mismatch. Expected ${expectedSha256}, got ${actualSha256}.`);
    }

    return {
        proxyPath,
        proxySha256: actualSha256,
        proxySource: `${PROXY_SOURCE} (${target})`
    };
}

function parseExpectedSha256(contents: string, binName: string): string | undefined {
    for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(trimmed);
        if (!match) {
            continue;
        }

        const filename = match[2].trim();
        if (filename === binName || path.basename(filename) === binName) {
            return match[1].toLowerCase();
        }
    }

    return undefined;
}

async function readMarkerOrThrow(markerPath: string): Promise<CpptoolsProxyMarker> {
    const marker = await readMarkerSafely(markerPath);
    if (!marker) {
        throw new Error(`Patch marker is missing or invalid: ${markerPath}`);
    }

    return marker;
}

async function readMarkerSafely(markerPath: string): Promise<CpptoolsProxyMarker | undefined> {
    try {
        const data = JSON.parse(await fs.readFile(markerPath, 'utf8')) as unknown;
        if (!isMarker(data)) {
            return undefined;
        }

        return data;
    } catch {
        return undefined;
    }
}

function isMarker(value: unknown): value is CpptoolsProxyMarker {
    if (!isRecord(value)) {
        return false;
    }

    return value.schema === MARKER_SCHEMA
        && value.patchedBy === PATCHED_BY
        && typeof value.patchedAt === 'string'
        && typeof value.cpptoolsExtensionVersion === 'string'
        && typeof value.platform === 'string'
        && typeof value.arch === 'string'
        && typeof value.originalPath === 'string'
        && typeof value.originalSha256 === 'string'
        && typeof value.proxySha256 === 'string'
        && typeof value.proxySource === 'string';
}

function validateMarker(marker: CpptoolsProxyMarker, install: CpptoolsInstall): string | undefined {
    if (marker.originalPath !== install.originalPath) {
        return `Patch marker points to a different original launcher: ${marker.originalPath}`;
    }

    if (marker.platform !== process.platform || marker.arch !== process.arch) {
        return `Patch marker platform mismatch: ${marker.platform}-${marker.arch}`;
    }

    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function chmodExecutableIfNeeded(filePath: string): Promise<void> {
    if (process.platform !== 'win32') {
        await fs.chmod(filePath, 0o755);
    }
}

async function rollbackOriginalRename(install: CpptoolsInstall): Promise<void> {
    if (await pathExists(install.originalPath)) {
        try {
            await fs.rename(install.originalPath, install.cpptoolsPath);
        } catch {
            // Leave the original backup in place so status reports Broken instead of hiding the failure.
        }
    }
}

async function rollbackDisabledRename(install: CpptoolsInstall, shouldRollback: boolean): Promise<void> {
    if (!shouldRollback) {
        return;
    }

    if (await pathExists(install.disabledPath)) {
        try {
            await fs.rename(install.disabledPath, install.cpptoolsPath);
        } catch {
            // Keep the disabled file for manual recovery if rollback fails.
        }
    }
}

async function removeTempFile(filePath: string): Promise<void> {
    try {
        await fs.unlink(filePath);
    } catch {
        // Best-effort cleanup only.
    }
}

function getExtensionVersion(extension: vscode.Extension<unknown>): string {
    const packageJson = extension.packageJSON as Record<string, unknown>;
    const version = packageJson.version;

    return typeof version === 'string' ? version : 'unknown';
}

function broken(install: CpptoolsInstall, reason: string): CpptoolsProxyStatus {
    return {
        kind: 'broken',
        extensionPath: install.extension.extensionPath,
        reason
    };
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
    return err instanceof Error && 'code' in err;
}
