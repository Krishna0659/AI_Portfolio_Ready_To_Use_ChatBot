/** Compare evidence as line occurrences, preserving repeated lines and their order. */
export function evidenceDiff(before:string,after:string){
 const lines=(text:string)=>text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 const subtract=(a:string[],b:string[])=>{const counts=new Map<string,number>();for(const line of b)counts.set(line,(counts.get(line)??0)+1);return a.filter(line=>{const n=counts.get(line)??0;if(n){counts.set(line,n-1);return false;}return true;});};
 const oldLines=lines(before),newLines=lines(after);
 return {added:subtract(newLines,oldLines),removed:subtract(oldLines,newLines),unchanged:before===after};
}
