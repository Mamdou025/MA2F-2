"""Fetch selected OCA source into ignored pilot storage; never install remotely."""
import ast
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEST = ROOT / '.local' / 'oca'
LOCK = ROOT / 'community-addons.lock.json'
SELECTION = {
    'stock-logistics-workflow': ['stock_no_negative'],
    'server-tools': ['auditlog'],
    'account-financial-reporting': ['account_financial_report'],
    'manufacture': ['quality_control_oca'],
    'server-ux': ['date_range'],
    'reporting-engine': ['report_xlsx'],
}

def git(*args, cwd=None):
    return subprocess.check_output(['git', *args], cwd=cwd, text=True, timeout=180).strip()

def main():
    DEST.mkdir(parents=True, exist_ok=True)
    previous = json.loads(LOCK.read_text()) if LOCK.exists() else {}
    records = {}
    for repo, modules in SELECTION.items():
        url = f'https://github.com/OCA/{repo}.git'
        commit = previous.get(repo, {}).get('commit') or git('ls-remote', url, 'refs/heads/19.0').split()[0]
        folder = DEST / repo
        if not folder.exists():
            folder.mkdir()
            git('init', cwd=folder)
            git('remote', 'add', 'origin', url, cwd=folder)
            git('sparse-checkout', 'init', '--cone', cwd=folder)
            git('sparse-checkout', 'set', *modules, cwd=folder)
        assert git('remote', 'get-url', 'origin', cwd=folder) == url
        assert not git('-c', 'core.autocrlf=true', 'status', '--porcelain', cwd=folder), f'Local edits in {repo}; preserve them before refreshing'
        git('fetch', '--depth=1', 'origin', commit, cwd=folder)
        git('checkout', '--detach', commit, cwd=folder)
        manifests = {}
        for module in modules:
            data = ast.literal_eval((folder / module / '__manifest__.py').read_text())
            assert data.get('installable') and data['version'].startswith('19.0.')
            assert data['license'] in ['AGPL-3', 'LGPL-3']
            manifests[module] = {k: data.get(k) for k in ['version', 'license', 'depends', 'external_dependencies']}
        records[repo] = {'url': url, 'commit': commit, 'modules': manifests}
        print(f'PINNED {repo} {commit}', flush=True)
    LOCK.write_text(json.dumps(records, indent=2) + '\n')

if __name__ == '__main__':
    main()
