import {NextResponse} from 'next/server';
import {deletionStatus} from '../../../packages/domain/lifecycle';
export const runtime='nodejs';
export async function GET(req:Request){
 const token=req.headers.get('x-deletion-receipt')??'';
 const result=await deletionStatus(token);
 return NextResponse.json(result??{error:'Deletion receipt not found'},{status:result?200:404,headers:{'Cache-Control':'no-store'}});
}
