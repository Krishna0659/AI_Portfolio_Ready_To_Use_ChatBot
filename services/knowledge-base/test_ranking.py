import unittest
from ranking import lexical, fuse

class RankingTests(unittest.TestCase):
    def test_terms_and_empty_queries(self):
        self.assertEqual(lexical('escrow', ['unrelated', 'escrow payments']), [1])
        self.assertEqual(lexical('the and', ['escrow']), [])
        self.assertEqual(lexical('anything', []), [])

    def test_fusion_rewards_agreement_without_duplicates(self):
        self.assertEqual(fuse(['a', 'b'], ['b', 'c'])[0], 'b')
        self.assertEqual(fuse(['a', 'a'], []), ['a'])
