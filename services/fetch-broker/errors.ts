import type {IncomingHttpHeaders} from 'node:http';
export class SourceHttpError extends Error {
 constructor(public status:number,public code:string,message:string,public retryAt:Date|null=null){super(message);}
}
export function httpFailure(status:number,host:string,headers:IncomingHttpHeaders,now=Date.now()){
 const github=host==='api.github.com';
 const exhausted=headers['x-ratelimit-remaining']==='0';
 const retry=Number(headers['retry-after']);const reset=Number(headers['x-ratelimit-reset']);
 if(status===429||github&&status===403&&(exhausted||headers['retry-after'])){
 const delay=Number.isFinite(retry)&&retry>0?retry*1000:exhausted&&Number.isFinite(reset)?reset*1000-now+1000:60000;
 const retryAt=new Date(now+Math.max(60000,Math.min(delay,24*60*60*1000)));
 return new SourceHttpError(status,'RATE_LIMITED',github?'GitHub’s shared API quota is exhausted. This import will retry automatically after the limit resets.':'The source is rate limiting requests. This import will retry after its waiting period.',retryAt);
 }
 if(status===403)return new SourceHttpError(status,'ACCESS_DENIED',github?'GitHub denied this repository request. Check repository visibility and access.':'The website refused automated access (HTTP 403). Upload a document you have permission to use instead.');
 if(status===404)return new SourceHttpError(status,'NOT_FOUND',github?'Repository or README not found. Check the URL; private repositories need GitHub App access.':'Page not found (HTTP 404). Check the URL.');
 return new SourceHttpError(status,'HTTP_ERROR',`Source returned HTTP ${status}.`,status>=500?new Date(now+60000):null);
}
