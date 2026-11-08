import { useState } from 'react';
import type { WorkflowStep } from '../api/contracts';
import type { RefOption } from './preflight';
import { findStep, type EditFn } from './stepConfigs';
import { DataRefPicker, NumberField, TextField } from './fields';

type Example = {inputs: Record<string, number>; expected: number};
export function VerificationStepInspector({step, bodyOf, edit, refs}: {step: WorkflowStep; bodyOf:string|null; edit:EditFn; refs:RefOption[]}) {
  const c=step.config as {skill?:{from?:string};cases?:Example[]};
  const cases=c.cases ?? [];
  const [parameter,setParameter]=useState('');
  const update=(fn:(config: typeof c)=>void)=>edit(d=>{const s=findStep(d,step.step_id,bodyOf);if(s)fn(s.config as typeof c);});
  const names=[...new Set(cases.flatMap(e=>Object.keys(e.inputs)))];
  return <section aria-label="Verify calculation">
    <h3>Verify calculation</h3>
    <p>Enter expected answers you know independently of the proposed calculation. Passing verifies these examples; it does not prove every possible input.</p>
    <DataRefPicker label="Calculation result" value={c.skill?.from ?? ''} options={refs} onCommit={from=>update(v=>{v.skill={from};})}/>
    <TextField label="Input name" value={parameter} onCommit={setParameter}/>
    <button type="button" disabled={!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(parameter)||names.includes(parameter)||names.length>=16} onClick={()=>{update(v=>{v.cases=(v.cases?.length?v.cases:[{inputs:{},expected:0}]).map(e=>({...e,inputs:{...e.inputs,[parameter]:0}}));});setParameter('');}}>Add input</button>
    {cases.map((example,i)=><fieldset key={i}><legend>Example {i+1}</legend>
      {Object.entries(example.inputs).map(([name,value])=><NumberField key={name} label={`Example ${i+1}: ${name}`} value={value} onCommit={n=>update(v=>{v.cases![i].inputs[name]=n;})}/>)}
      <NumberField label={`Example ${i+1}: expected answer`} value={example.expected} onCommit={n=>update(v=>{v.cases![i].expected=n;})}/>
      <button type="button" onClick={()=>update(v=>{v.cases=v.cases!.filter((_,index)=>index!==i);})}>Remove example {i+1}</button>
    </fieldset>)}
    <button type="button" disabled={!names.length||cases.length>=20} onClick={()=>update(v=>{v.cases=[...(v.cases??[]),{inputs:Object.fromEntries(names.map(n=>[n,0])),expected:0}];})}>Add example</button>
  </section>;
}
