import re
import unittest
from hierarchy import build_hierarchy, calibrated_threshold, recall_preserving_threshold


class HierarchyTests(unittest.TestCase):
    def test_recall_cutoff_uses_only_calibration_questions(self):
        cases=[{'split':'calibration','answerable':True,'candidates':[{'score':-2.,'relevant':True}]}]
        self.assertEqual(recall_preserving_threshold(cases),-2.)
        with self.assertRaises(ValueError):
            recall_preserving_threshold([{**cases[0],'split':'validation'}])
    def test_overlap_preserves_source_and_section_boundaries(self):
        def tokenizer(text, **kwargs):
            return {'offset_mapping': [m.span() for m in re.finditer(r'\S+', text)]}
        parents, children = build_hierarchy([
            {'section': 'Manual', 'text': 'one two three four five six seven'},
            {'section': 'Policy', 'text': 'eight nine'}], tokenizer,
            child_tokens=4, overlap_tokens=2)
        self.assertEqual([c['text'] for c in children],
                         ['one two three four', 'three four five six', 'five six seven', 'eight nine'])
        self.assertEqual(len(parents), 2)
        self.assertEqual(children[0]['parent_id'], children[2]['parent_id'])
        self.assertNotEqual(children[2]['parent_id'], children[3]['parent_id'])

    def test_threshold_uses_model_scores_without_probability_assumption(self):
        result = calibrated_threshold([(-5, False), (-2, False), (2, True), (7, True)])
        self.assertEqual(result['threshold'], 2)
        self.assertEqual(result['f1'], 1)
        with self.assertRaises(ValueError):
            calibrated_threshold([(1, True)])
