import unittest
from unittest.mock import MagicMock,patch
from parent_retrieval import rerank_parents


class ParentRetrievalTests(unittest.TestCase):
    def test_rerank_rejects_low_scores_and_deduplicates_parent(self):
        rows=[{'text':'child '+str(i),'distance':None,'metadata':{
            'section':'Manual','parent_record_id':p,'parent_text':'Complete '+p,
            'chunk_id':p,'child_start':i,'child_end':i+48,'profile_subject':'Example subject'}}
            for i,p in enumerate(['one','one','two'])]
        scorer=MagicMock()
        scorer.encode.return_value.tolist.return_value=[5.,-100.]
        with patch('parent_retrieval.reranker',return_value=scorer):
            result=rerank_parents('question',rows,3)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['text'],'Complete one')
        self.assertEqual(result[0]['metadata'],{'section':'Manual','chunk_id':'one'})
        self.assertEqual(scorer.encode.call_args.args[0][0],('question','Profile: Example subject\nSection: Manual\nComplete one'))
        self.assertEqual(len(scorer.encode.call_args.args[0]),2)

    def test_invalid_scores_fail_closed(self):
        from fastapi import HTTPException
        row={'text':'child','metadata':{'section':'Manual'}}
        for scores in [[],[float('nan')]]:
            scorer=MagicMock()
            scorer.encode.return_value.tolist.return_value=scores
            with patch('parent_retrieval.reranker',return_value=scorer),self.assertRaises(HTTPException):
                rerank_parents('question',[row],3)
