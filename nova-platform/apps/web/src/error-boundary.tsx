import React from 'react';
import {reportClientError} from './client-errors';

export class PageBoundary extends React.Component<{children:React.ReactNode;resetKey?:string},{failed:boolean;reference:string;resetKey?:string}>{
 state={failed:false,reference:'',resetKey:this.props.resetKey};
 static getDerivedStateFromError(){return {failed:true};}
 static getDerivedStateFromProps(props:{resetKey?:string},state:{resetKey?:string}){return props.resetKey!==state.resetKey?{failed:false,reference:'',resetKey:props.resetKey}:null;}
 componentDidCatch(error:Error,info:React.ErrorInfo){this.setState({reference:reportClientError('react',error,info.componentStack||'')});}
 render(){
  if(!this.state.failed)return this.props.children;
  return <section className="empty error-page" role="alert"><h1>This page could not open.</h1><p>NOVA ran into a display error. Try again, or return to Home.</p><div className="actions"><button className="primary" onClick={()=>this.setState({failed:false,reference:''})}>Try again</button><button className="secondary" onClick={()=>location.assign('/home')}>Back to Home</button></div>{this.state.reference&&<p className="small">Error reference: {this.state.reference}</p>}</section>;
 }
}
