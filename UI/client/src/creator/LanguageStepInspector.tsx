import type { WorkflowStep } from '../api/contracts';
import type { RefOption } from './preflight';
import { findStep, type EditFn } from './stepConfigs';
import { CheckField, DataRefPicker, NumberField, TextField } from './fields';
import { useState, useRef } from 'react';
import {useDraftLanguageMutation} from '../api/steelApi';
export function LanguageStepInspector({step,bodyOf,edit,refs,contextId}:{contextId?:string;step:WorkflowStep;bodyOf:string|null;edit:EditFn;refs:RefOption[]}) {
  const context=JSON.stringify([contextId,step.step_id,bodyOf,step.config]);
  const current=useRef(context);current.current=context;
  const [instruction,setInstruction]=useState('');
  const [draft,status]=useDraftLanguageMutation();
  const c=step.config as Record<string,any>;
  const [error,setError]=useState('');
  const set=(key:string,value:unknown)=>edit(d=>{const s=findStep(d,step.step_id,bodyOf);if(s)s.config={...s.config,[key]:value};});
  if(step.type==='lang_recall')return <section aria-label="Recall executions"><CheckField label="Only definition-verified cases" checked={c.verified_only===true} onChange={v=>set('verified_only',v)}/><TextField label="Recall query" value={c.query_template??''} onCommit={v=>set('query_template',v)}/><CheckField label="Require exact verified candidate" checked={!!c.match} onChange={enabled=>edit(d=>{const s=findStep(d,step.step_id,bodyOf);if(!s)return;const config={...s.config} as Record<string,any>;if(enabled){config.verified_only=true;config.match={source_sha256:'',definition_sha256:''};}else delete config.match;s.config=config;})}/>
    {c.match&&<fieldset><legend>Exact verification identity</legend>{[['source_sha256','Candidate source SHA-256'],['definition_sha256','Verification definition SHA-256'],['repository_sha256','Repository provenance SHA-256 (optional)']].map(([key,label])=><TextField key={key} label={label} value={c.match[key]??''} onCommit={v=>{const match={...c.match,[key]:v};if(key==='repository_sha256'&&!v)delete match[key];set('match',match);}}/>)}</fieldset>}
    <p>Exact selection filters verified cases before ranking. No match returns no candidate; it never falls back to similarity. Copy hashes from the verification evidence and test the selected source again before reuse.</p></section>;
  if(step.type==='lang_verification')return <section aria-label="Verify observed source">
    <DataRefPicker label="Observed execution ID" value={c.candidate?.from??''} options={refs} onCommit={from=>set('candidate',{from})}/>
    <NumberField label="Source output index" value={c.output_index??0} onCommit={v=>set('output_index',v)}/>
    <p>Enter tests independently of generated source. They become immutable in the published version. Passing promotes a case only for these examples, not universal correctness.</p>
    {(c.tests??[]).map((t:any,i:number)=><fieldset key={i}><legend>Test {i+1}</legend>
      <TextField label={`Test ${i+1} program`} multiline value={t.program} onCommit={v=>set('tests',c.tests.map((x:any,j:number)=>j===i?{...x,program:v}:x))}/>
      <TextField label={`Test ${i+1} expected output`} multiline value={t.expected_stdout} onCommit={v=>set('tests',c.tests.map((x:any,j:number)=>j===i?{...x,expected_stdout:v}:x))}/>
      <button type="button" onClick={()=>set('tests',c.tests.filter((_:any,j:number)=>j!==i))}>Remove test {i+1}</button></fieldset>)}
    <button type="button" disabled={(c.tests?.length??0)>=32} onClick={()=>set('tests',[...(c.tests??[]),{program:'',expected_stdout:''}])}>Add verification test</button>
  </section>;
  return <section aria-label="Execute language">
    <CheckField label="Load inputs from an authorized repository" checked={!!c.repository} onChange={enabled=>edit(d=>{
      const s=findStep(d,step.step_id,bodyOf);if(!s)return;
      const config={...s.config} as Record<string,any>;
      if(enabled){config.repository={grant:'',commit:'',paths:[]};config.resources={...config.resources};delete config.resources.inputs;config.bindings={...config.bindings};delete config.bindings.inputs;}
      else delete config.repository;
      s.config=config;
    })}/>
    {c.repository&&<fieldset><legend>Repository source</legend>
      <TextField label="Repository grant ID" value={c.repository.grant??''} onCommit={v=>set('repository',{...c.repository,grant:v})}/>
      <TextField label="Exact source commit" value={c.repository.commit??''} onCommit={v=>set('repository',{...c.repository,commit:v})}/>
      <TextField label="Repository paths (one per line)" multiline value={(c.repository.paths??[]).join('\n')} onCommit={v=>set('repository',{...c.repository,paths:v.split('\n').map(p=>p.trim()).filter(Boolean)})}/>
      <p>The runtime owner must grant this account access to these exact files and commit. Files load in the listed order during execution. Repository source is not sent to the model by the draft button.</p>
    </fieldset>}
    <TextField label="Describe the program" multiline value={instruction} onCommit={setInstruction}/>
    <button type="button" disabled={status.isLoading || !instruction.trim()} onClick={async()=>{try{const started=context;const proposal=await draft({instruction,inputs:c.resources?.inputs??[],replacements:c.resources?.replacements??[]}).unwrap();if(current.current!==started)return;set('program',proposal.program);setError('Draft source received. Save and test it before verification or reuse.');}catch{setError('Generation unavailable or refused. An authorized language connector is required.');}}}>Draft executable program</button>
    <TextField label="Problem description" value={c.problem??''} onCommit={v=>set('problem',v)}/>
    <TextField label="Executable .lang program" multiline value={c.program??''} onCommit={v=>set('program',v)}/>
    <p>The program executes with bounded text and testing capabilities. Expected answers must come from your requirements. Results are observations, not automatically approved rules.</p>
    <TextField label="Resource data (JSON)" multiline value={JSON.stringify(c.resources??{},null,2)} onCommit={v=>{try{const value=JSON.parse(v);if(!value||Array.isArray(value)||typeof value!=='object')throw Error();set('resources',value);setError('');}catch{setError('Enter a JSON object containing resource arrays.');}}}/>
    {error&&<p role="alert">{error}</p>}
    {(c.repository?['replacements','expectations','tests']:['inputs','replacements','expectations','tests']).map(key=><DataRefPicker key={key} label={`Optional ${key} source`} value={c.bindings?.[key]?.from??''} options={refs} onCommit={from=>{const b={...c.bindings};if(from)b[key]={from};else delete b[key];set('bindings',b);}}/>)}
  </section>;
}
