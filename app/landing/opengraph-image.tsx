import {ImageResponse} from 'next/og';
export const alt = 'SiteSage — Your website, ready to answer';
export const size = {width:1200,height:630};
export const contentType = 'image/png';
export default function Image(){return new ImageResponse(<div style={{display:'flex',flexDirection:'column',justifyContent:'center',width:'100%',height:'100%',background:'#f4f2ed',color:'#182c28',padding:'80px'}}><div style={{fontSize:32,marginBottom:48}}>SiteSage</div><div style={{display:'flex',flexDirection:'column',fontSize:80,lineHeight:1.1}}><span>Your website,</span><span>ready to answer.</span></div><div style={{fontSize:28,marginTop:40}}>Your website. Your sources. Your answers.</div></div>,size);}
