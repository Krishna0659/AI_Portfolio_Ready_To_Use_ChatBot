import unittest
from datetime import date
from unittest.mock import patch
import azure_pilot as pilot


class AzurePilotTests(unittest.TestCase):
    def test_budget_dates_and_thresholds(self):
        props = pilot.budget_body('test@example.com', date(2026, 12, 31))['properties']
        self.assertEqual(props['amount'], 50)
        self.assertEqual(props['timePeriod']['startDate'], '2026-12-01T00:00:00Z')
        self.assertEqual(props['timePeriod']['endDate'], '2027-12-01T00:00:00Z')
        self.assertEqual([n['threshold'] for n in props['notifications'].values()], [50, 80, 100])

    def test_unknown_or_wrong_currency_cannot_create_vm(self):
        for currency in (None, '', 'INR'):
            with self.assertRaises(RuntimeError):
                pilot.verify_budget({'properties': {'amount': 50, 'timeGrain': 'Monthly',
                    'currentSpend': {'unit': currency}}})

    def test_portal_confirmation_only_fills_missing_currency(self):
        for currency in (None, '', 'USD'):
            pilot.verify_budget({'properties': {'amount': 50, 'timeGrain': 'Monthly',
                'currentSpend': {'unit': currency}}}, portal_confirmed_usd=True)
        for currency, amount, grain in [('INR', 50, 'Monthly'), ('', 500, 'Monthly'),
                                        ('', 50, 'Annually')]:
            with self.assertRaises(RuntimeError):
                pilot.verify_budget({'properties': {'amount': amount, 'timeGrain': grain,
                    'currentSpend': {'unit': currency}}}, portal_confirmed_usd=True)

    def test_budget_failure_stops_before_resource_creation(self):
        with patch.object(pilot, 'az', side_effect=[{'id': 'test', 'state': 'Enabled'}, RuntimeError('budget denied')]) as call:
            with self.assertRaises(RuntimeError):
                pilot.provision('test', 'test@example.com')
            self.assertEqual(call.call_count, 2)
            self.assertFalse(any('create' in c.args for c in call.call_args_list))

    def test_approved_vm_only_and_no_open_ssh(self):
        args = pilot.vm_arguments('/tmp/test.pub')
        self.assertEqual(args[args.index('--size')+1], 'Standard_B2as_v2')
        self.assertEqual(args[args.index('--os-disk-size-gb')+1], '64')
        self.assertEqual(args[args.index('--nsg-rule')+1], 'NONE')
        self.assertNotIn('--zone', args)
        self.assertNotIn('--admin-password', args)


if __name__ == '__main__':
    unittest.main()
