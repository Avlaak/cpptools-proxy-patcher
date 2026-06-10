import * as vscode from 'vscode';

import {
    CpptoolsProxyStatus,
    getCpptoolsProxyErrorMessage,
    getCpptoolsProxyRecoveryInfo,
    getCpptoolsProxyStatus,
    getCpptoolsProxyStatusLabel,
    getCpptoolsProxyStatusMessage,
    patchCpptoolsProxy,
    preflightCpptoolsProxyPatch,
    restoreCpptoolsProxy
} from './cpptoolsProxyPatcher';
import { checkForUpdates, scheduleAutoUpdateCheck } from './updater';

let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
    statusBarItem.command = 'cpptoolsProxyPatcher.status';
    statusBarItem.name = 'C/C++ Tools Proxy';
    context.subscriptions.push(statusBarItem);

    context.subscriptions.push(
        vscode.commands.registerCommand('cpptoolsProxyPatcher.patch', () => patchCommand(context)),
        vscode.commands.registerCommand('cpptoolsProxyPatcher.restore', () => restoreCommand()),
        vscode.commands.registerCommand('cpptoolsProxyPatcher.status', () => statusCommand()),
        vscode.commands.registerCommand('cpptoolsProxyPatcher.refreshStatus', () => refreshStatus()),
        vscode.commands.registerCommand('cpptoolsProxyPatcher.checkUpdates', () => checkForUpdates(false))
    );

    scheduleAutoUpdateCheck(context);

    void refreshStatus();
}

export function deactivate(): void { }

async function patchCommand(context: vscode.ExtensionContext): Promise<void> {
    const status = await refreshStatus();
    if (status.kind !== 'available') {
        showStatusMessage(status);
        return;
    }

    try {
        await preflightCpptoolsProxyPatch(context);
    } catch (err) {
        await refreshStatus();
        vscode.window.showErrorMessage(`C/C++ Tools Proxy patch failed: ${getCpptoolsProxyErrorMessage(err)}`);
        return;
    }

    const patch = 'Patch';
    const cancel = 'Cancel';
    const selection = await vscode.window.showWarningMessage(
        'Patch Microsoft C/C++ Tools by replacing its local language-server launcher with bundled cpptools-proxy? This modifies the installed ms-vscode.cpptools files on this machine and can be restored.',
        { modal: true },
        patch,
        cancel
    );

    if (selection !== patch) {
        return;
    }

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Patching C/C++ Tools Proxy...',
                cancellable: false
            },
            () => patchCpptoolsProxy(context)
        );

        await refreshStatus();
        await promptReloadWindow('C/C++ Tools Proxy patched. Reload the window so Microsoft C/C++ Tools restarts cleanly?');
    } catch (err) {
        await refreshStatus();
        vscode.window.showErrorMessage(`C/C++ Tools Proxy patch failed: ${getCpptoolsProxyErrorMessage(err)}`);
    }
}

async function restoreCommand(): Promise<void> {
    const status = await refreshStatus();

    if (status.kind === 'patched') {
        const restore = 'Restore';
        const cancel = 'Cancel';
        const selection = await vscode.window.showWarningMessage(
            'Restore the original Microsoft C/C++ Tools launcher and disable the local cpptools-proxy patch?',
            { modal: true },
            restore,
            cancel
        );

        if (selection !== restore) {
            return;
        }

        await runRestore(false);
        return;
    }

    if (status.kind === 'broken') {
        const recoveryInfo = await getCpptoolsProxyRecoveryInfo();

        if (!recoveryInfo.canRestore) {
            vscode.window.showErrorMessage(`C/C++ Tools Proxy cannot restore: ${recoveryInfo.reason}`);
            return;
        }

        const restoreAnyway = 'Restore Original Anyway';
        const cancel = 'Cancel';
        const selection = await vscode.window.showWarningMessage(
            `C/C++ Tools Proxy is broken: ${status.reason}\n\n${recoveryInfo.reason}\n\nRestore the saved original launcher anyway? The current launcher will be moved aside if it exists.`,
            { modal: true },
            restoreAnyway,
            cancel
        );

        if (selection !== restoreAnyway) {
            return;
        }

        await runRestore(true);
        return;
    }

    showStatusMessage(status);
}

async function runRestore(recovery: boolean): Promise<void> {
    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Restoring C/C++ Tools...',
                cancellable: false
            },
            () => restoreCpptoolsProxy(recovery)
        );

        await refreshStatus();
        await promptReloadWindow('C/C++ Tools restored. Reload the window so Microsoft C/C++ Tools restarts cleanly?');
    } catch (err) {
        await refreshStatus();
        vscode.window.showErrorMessage(`C/C++ Tools Proxy restore failed: ${getCpptoolsProxyErrorMessage(err)}`);
    }
}

async function statusCommand(): Promise<void> {
    const status = await refreshStatus();
    showStatusMessage(status);
}

async function refreshStatus(): Promise<CpptoolsProxyStatus> {
    const status = await getCpptoolsProxyStatus();
    await updateContextKeys(status);
    updateStatusBar(status);

    return status;
}

function updateStatusBar(status: CpptoolsProxyStatus): void {
    if (!statusBarItem) {
        return;
    }

    statusBarItem.text = `$(plug) C/C++ Proxy: ${getCpptoolsProxyStatusLabel(status)}`;
    statusBarItem.tooltip = getCpptoolsProxyStatusMessage(status);
    statusBarItem.backgroundColor = status.kind === 'broken'
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
    statusBarItem.show();
}

async function updateContextKeys(status: CpptoolsProxyStatus): Promise<void> {
    await vscode.commands.executeCommand(
        'setContext',
        'cpptoolsProxyPatcher.patchable',
        status.kind === 'available'
    );

    await vscode.commands.executeCommand(
        'setContext',
        'cpptoolsProxyPatcher.restorable',
        status.kind === 'patched' || status.kind === 'broken'
    );
}

function showStatusMessage(status: CpptoolsProxyStatus): void {
    const message = getCpptoolsProxyStatusMessage(status);

    if (status.kind === 'broken') {
        vscode.window.showWarningMessage(message);
        return;
    }

    vscode.window.showInformationMessage(message);
}

async function promptReloadWindow(message: string): Promise<void> {
    const reload = 'Reload Window';
    const selection = await vscode.window.showInformationMessage(message, reload);

    if (selection === reload) {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}
