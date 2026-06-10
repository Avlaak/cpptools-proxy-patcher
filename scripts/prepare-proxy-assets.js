#!/usr/bin/env node

'use strict';

const fs = require('fs/promises');
const https = require('https');
const path = require('path');
const { createHash } = require('crypto');

const repoRoot = path.resolve(__dirname, '..');
const outputRoot = path.join(repoRoot, 'resources', 'cpptools-proxy');
const releaseTag = '1.0.0';
const releaseBaseUrl = `https://github.com/matu6968/cpptools-proxy/releases/download/${releaseTag}`;

const targets = [
    {
        target: 'darwin-arm64',
        asset: 'cpptools-proxy-arm64-macos',
        binName: 'cpptools',
        sha256: 'ab8b41b3bc6be0ca28d53278161abd5a41d25af034c9834fd6f1e2499d891140'
    },
    {
        target: 'darwin-x64',
        asset: 'cpptools-proxy-x86_64-macos',
        binName: 'cpptools',
        sha256: 'eb9d9cf6f80add43a565adb478865887e60097add1079f816fe375acfc45960a'
    },
    {
        target: 'linux-arm',
        asset: 'cpptools-proxy-arm-linux',
        binName: 'cpptools',
        sha256: '69da241d5a5af5e2ff29814c13d99d68aca77b8869d887fa43e96c6aac005fc7'
    },
    {
        target: 'linux-arm64',
        asset: 'cpptools-proxy-arm64-linux',
        binName: 'cpptools',
        sha256: '1c588bf55a8bcba113e4ebe9ec5ff68af04d0006943ec63176ad56da634634bb'
    },
    {
        target: 'linux-ia32',
        asset: 'cpptools-proxy-x86-linux',
        binName: 'cpptools',
        sha256: '475fc5b51928e20759d7e69b0b7ce9be8dbc4ba26d35d2ea916bfa5b179ce033'
    },
    {
        target: 'linux-x64',
        asset: 'cpptools-proxy-x86_64-linux',
        binName: 'cpptools',
        sha256: '321925d434e6bfdb067ba6f2d3d43668d5bbc365bb76186637946ea4a1ce464a'
    },
    {
        target: 'win32-arm64',
        asset: 'cpptools-proxy-arm64.exe',
        binName: 'cpptools.exe',
        sha256: '36e4374b134bd13a59499c3b245c7da66c3d638f96030114900276a208620ad4'
    },
    {
        target: 'win32-ia32',
        asset: 'cpptools-proxy-x86.exe',
        binName: 'cpptools.exe',
        sha256: 'a1909601c1cc7bbb7a46005da8cf052465eb1c7351d4c870b83537a1bbbe4487'
    },
    {
        target: 'win32-x64',
        asset: 'cpptools-proxy-x86_64.exe',
        binName: 'cpptools.exe',
        sha256: 'fd087408783237f25aca33e9bb8e3af30e6b1d75f5e956ff4358ee9c99135b57'
    }
];

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
});

async function main() {
    for (const target of targets) {
        await prepareTarget(target);
    }
}

async function prepareTarget(target) {
    const targetDir = path.join(outputRoot, target.target);
    const binaryPath = path.join(targetDir, target.binName);
    const sumsPath = path.join(targetDir, 'SHA256SUMS');

    await fs.mkdir(targetDir, { recursive: true });

    if (!(await hasExpectedSha256(binaryPath, target.sha256))) {
        const url = `${releaseBaseUrl}/${target.asset}`;
        console.log(`Downloading ${target.target} from ${url}`);
        const data = await download(url);
        const actual = sha256(data);

        if (actual !== target.sha256) {
            throw new Error(`Hash mismatch for ${target.asset}. Expected ${target.sha256}, got ${actual}.`);
        }

        await fs.writeFile(binaryPath, data);
    } else {
        console.log(`Using cached ${target.target}`);
    }

    if (!target.binName.endsWith('.exe')) {
        await fs.chmod(binaryPath, 0o755);
    }

    await fs.writeFile(sumsPath, `${target.sha256}  ${target.binName}\n`, 'utf8');
}

function download(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'cpptools-proxy-patcher-build' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                if (!res.headers.location) {
                    reject(new Error(`Redirect without location for ${url}`));
                    return;
                }

                download(res.headers.location).then(resolve, reject);
                return;
            }

            if (res.statusCode !== 200) {
                reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
                return;
            }

            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

async function hasExpectedSha256(filePath, expectedSha256) {
    try {
        const data = await fs.readFile(filePath);
        return sha256(data) === expectedSha256;
    } catch {
        return false;
    }
}

function sha256(data) {
    return createHash('sha256').update(data).digest('hex');
}
