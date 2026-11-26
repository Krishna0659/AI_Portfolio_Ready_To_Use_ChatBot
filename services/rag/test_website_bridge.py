import unittest
from unittest.mock import patch
from website_bridge import approved_document, MODEL, PROFILE, WebsiteGemini
from gemini import GeminiClient, ProviderError
from indexing import form_batch


class WebsitePreparationTests(unittest.TestCase):
    def test_provider_diagnostic_is_a_safe_error_code(self):
        provider = WebsiteGemini(api_key='test-key')
        with patch.object(GeminiClient, '_request', side_effect=ProviderError('provider_http_503')):
            with self.assertRaises(ProviderError):
                provider._request('countTokens', {}, 1)
        self.assertEqual(provider.last_error, 'provider_http_503')

    def job(self, text):
        return dict(tenant_id='tenant-a', version_id='version-a', profile_version=2, generation=3,
                    content=dict(displayName='Mira Vale', headline='Engineer', sections=[
                        dict(title='Experience', facts=[dict(text=text)])]))

    def test_preserves_qualifiers_and_unicode(self):
        job = self.job('Did not lead the project.\n\nCoordinated José’s robotics club.')
        document = approved_document(job)
        self.assertEqual(document['chunks'][1]['text'], job['content']['sections'][0]['facts'][0]['text'])
        self.assertEqual(document['chunks'][1]['metadata']['document_id'], 'version-a')

    def test_large_parents_split_without_losing_words(self):
        job = self.job(' '.join(f'word{i}' for i in range(1400)))
        document = approved_document(job)
        rows = document['chunks'][1:]
        self.assertGreater(len(rows), 1)
        self.assertTrue(all(len(r['text']) <= 4000 for r in rows))
        self.assertEqual(' '.join(r['text'] for r in rows), job['content']['sections'][0]['facts'][0]['text'])
        form_batch([document], tenant_id='tenant-a', profile_id=PROFILE, profile_version=2,
                   generation=3, embedding_model=MODEL, subject='Mira Vale', approved=True)

    def test_retry_recreates_identical_snapshot(self):
        job = self.job('Built an accessible website.')
        def batch():
            return form_batch([approved_document(job)], tenant_id='tenant-a', profile_id=PROFILE,
                profile_version=2, generation=3, embedding_model=MODEL, subject='Mira Vale', approved=True)
        self.assertEqual(batch().batch_id, batch().batch_id)

    def test_duplicate_paragraph_parent_is_not_duplicated(self):
        job = self.job('Same fact.')
        job['content']['sections'].append(job['content']['sections'][0])
        self.assertEqual(len(approved_document(job)['chunks']), 2)


if __name__ == '__main__':
    unittest.main()
