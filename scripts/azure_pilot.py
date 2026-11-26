"""Run in Azure Cloud Shell. Provision only the explicitly approved pilot infrastructure."""
import argparse
from datetime import date
import json
from pathlib import Path
import re
import subprocess
import tempfile
import uuid

GROUP = 'portfolioai-pilot-rg'
VM = 'portfolioai-backend'
REGION = 'centralindia'
SIZE = 'Standard_B2as_v2'
OWNER = 'portfolioai-pilot'


def az(subscription, *args):
    result = subprocess.run(['az', *args, '--subscription', subscription,
                             '--only-show-errors', '--output', 'json'],
                            text=True, stdout=subprocess.PIPE, check=True)
    return json.loads(result.stdout) if result.stdout.strip() else None


def budget_body(email, today):
    start = today.replace(day=1)
    end = start.replace(year=start.year + 1)
    notices = {}
    for percent in (50, 80, 100):
        notices[f'actual_{percent}'] = dict(enabled=True, operator='GreaterThanOrEqualTo',
            threshold=percent, thresholdType='Actual', contactEmails=[email], locale='en-us')
    return {'properties': dict(category='Cost', amount=50, timeGrain='Monthly',
        timePeriod={'startDate': start.isoformat()+'T00:00:00Z',
                    'endDate': end.isoformat()+'T00:00:00Z'}, notifications=notices)}


def verify_budget(value):
    props = value['properties']
    currency = (props.get('currentSpend') or {}).get('unit')
    if currency != 'USD' or props.get('amount') != 50 or props.get('timeGrain') != 'Monthly':
        raise RuntimeError(f'Budget currency/amount could not be confirmed as USD 50 (currency={currency}). '
                           'No VM created. Send this message back before continuing.')


def vm_arguments(public_key):
    # No zone: all zonal Basv2 deployments were restricted in the checked subscription.
    # No inbound rules: use Azure Run Command for initial setup, then expose HTTPS only.
    return ['vm', 'create', '--resource-group', GROUP, '--name', VM,
        '--location', REGION, '--size', SIZE, '--image', 'Ubuntu2204',
        '--admin-username', 'portfolioadmin', '--authentication-type', 'ssh',
        '--ssh-key-values', str(public_key), '--os-disk-name', VM+'-os',
        '--os-disk-size-gb', '64', '--storage-sku', 'StandardSSD_LRS',
        '--public-ip-address', VM+'-ip', '--public-ip-sku', 'Standard',
        '--vnet-name', VM+'-vnet', '--subnet', 'backend',
        '--nsg', VM+'-nsg', '--nsg-rule', 'NONE', '--tags', 'managed-by='+OWNER]


def provision(subscription, email):
    account = az(subscription, 'account', 'show')
    if account['id'].lower() != subscription.lower() or account['state'] != 'Enabled':
        raise RuntimeError('Requested subscription is not active in this Cloud Shell session.')
    print('Creating subscription-wide monthly budget: USD 50; alerts at USD 25, 40 and 50.', flush=True)
    print('Budget alerts do not stop spending. They cover all costs in this subscription.', flush=True)
    budget_url = (f'https://management.azure.com/subscriptions/{subscription}'
        '/providers/Microsoft.Consumption/budgets/portfolioai-pilot-50-monthly?api-version=2024-08-01')
    with tempfile.TemporaryDirectory(prefix='portfolioai-budget-') as directory:
        payload = Path(directory)/'budget.json'
        payload.write_text(json.dumps(budget_body(email, date.today())), encoding='utf-8')
        az(subscription, 'rest', '--method', 'put', '--url', budget_url, '--body', '@'+str(payload))
    verify_budget(az(subscription, 'rest', '--method', 'get', '--url', budget_url))
    print('Budget verified. Checking resource group ownership.', flush=True)
    groups = az(subscription, 'group', 'list')
    existing = next((g for g in groups if g['name'].lower() == GROUP), None)
    if existing and ((existing.get('tags') or {}).get('managed-by') != OWNER
                     or existing['location'].lower() != REGION):
        raise RuntimeError('Resource group already exists with different ownership/location; nothing overwritten.')
    if not existing:
        az(subscription, 'group', 'create', '--name', GROUP, '--location', REGION,
           '--tags', 'managed-by='+OWNER)
    machines = az(subscription, 'vm', 'list', '--resource-group', GROUP)
    machine = next((v for v in machines if v['name'].lower() == VM), None)
    if machine:
        if ((machine.get('tags') or {}).get('managed-by') != OWNER
                or machine['hardwareProfile']['vmSize'] != SIZE
                or machine.get('provisioningState') != 'Succeeded'):
            raise RuntimeError('Existing VM differs from the approved setup or is incomplete. Stop and send the error; no replacement attempted.')
        print('Existing pilot VM found; not creating a second one.', flush=True)
    else:
        key = Path.home()/'.ssh'/'portfolioai-pilot'
        key.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if not key.exists() and not key.with_suffix('.pub').exists():
            subprocess.run(['ssh-keygen', '-q', '-t', 'rsa', '-b', '4096', '-N', '', '-f', str(key)], check=True)
        if not key.is_file() or not key.with_suffix('.pub').is_file():
            raise RuntimeError('Incomplete SSH key pair; no key overwritten and no VM created.')
        key.chmod(0o600)
        print('Creating approved VM: 2 vCPU / 8 GiB, 64 GiB SSD. Expected base cost about USD 45/month.', flush=True)
        print('If allocation fails, stop here; do not choose a different size or repeatedly retry.', flush=True)
        az(subscription, *vm_arguments(key.with_suffix('.pub')))
    details = az(subscription, 'vm', 'show', '--resource-group', GROUP, '--name', VM, '--show-details')
    print(json.dumps({'resourceGroup': GROUP, 'name': VM, 'size': details['hardwareProfile']['vmSize'],
        'location': details['location'], 'provisioningState': details['provisioningState'],
        'powerState': details.get('powerState'), 'publicIps': details.get('publicIps'),
        'budget': 'USD 50/month; notifications only', 'inboundPorts': 'No custom inbound access opened',
        'applicationDeployed': False}, indent=2))
    print('Keep the SSH private key in ~/.ssh/portfolioai-pilot private. Download it using the Cloud Shell file menu before ending an ephemeral session.')
    print('Infrastructure only: the website, Chroma and RAG are NOT deployed yet. Send back the summary above.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--subscription', required=True, type=lambda x: str(uuid.UUID(x)))
    parser.add_argument('--email', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', args.email):
        parser.error('Supply a valid alert email address.')
    if not args.apply:
        parser.error('--apply is required: this provisions billable resources using your Azure credits.')
    try:
        provision(args.subscription, args.email)
    except (RuntimeError, subprocess.CalledProcessError) as exc:
        print('SETUP STOPPED:', str(exc))
        print('Do not rerun blindly. Existing disks/IPs from a partial deployment can still accrue charges; send the error for inspection.')
        raise SystemExit(1)
