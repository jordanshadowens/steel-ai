import {useState} from 'react';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
import {LanguageStepInspector} from './LanguageStepInspector';
import {defaultConfig} from './adapter';
import type {WorkflowDefinition} from '../api/contracts';
vi.mock('../api/steelApi',()=>({useDraftLanguageMutation:()=>[()=>({unwrap:async()=>({program:'print 42;'})}),{isLoading:false}]}));
afterEach(cleanup);
test('repository selection removes conflicting inputs and persists customer source selection',()=>{
 let saved:WorkflowDefinition;
 const initial={workflow_id:'repo',steps:[{step_id:'code',type:'lang_execution',config:{...defaultConfig('lang_execution'),bindings:{inputs:{from:'old'}}}}]} as WorkflowDefinition;
 function Form(){const [d,set]=useState(initial);saved=d;return <LanguageStepInspector step={d.steps![0]} bodyOf={null} refs={[]} edit={fn=>set(old=>{const n=structuredClone(old);fn(n);return n;})}/>;}
 render(<Form/>);fireEvent.click(screen.getByLabelText('Load inputs from an authorized repository'));
 for(const [label,value] of [['Repository grant ID','customer-source'],['Exact source commit','a'.repeat(40)],['Repository paths (one per line)','src/one.lang\nsrc/two.lang']]){
  const field=screen.getByLabelText(label);fireEvent.change(field,{target:{value}});fireEvent.blur(field);
 }
 expect(saved!.steps![0].config!.repository).toEqual({grant:'customer-source',commit:'a'.repeat(40),paths:['src/one.lang','src/two.lang']});
 expect(saved!.steps![0].config!.resources).not.toHaveProperty('inputs');expect(saved!.steps![0].config!.bindings).not.toHaveProperty('inputs');
});
test('customer program and resource edits persist; invalid data is not silently committed',()=>{
 let saved:WorkflowDefinition;
 const initial={workflow_id:'coding',version:1,status:'draft',inputs:[],outputs:{},limits:{max_rounds:5,max_iterations:1},steps:[{step_id:'code',type:'lang_execution',name:'Code',config:defaultConfig('lang_execution'),on_success:'end'}]} as WorkflowDefinition;
 function Form(){const [d,set]=useState(initial);saved=d;return <LanguageStepInspector step={d.steps![0]} bodyOf={null} refs={[]} edit={fn=>set(old=>{const n=structuredClone(old);fn(n);return n;})}/>;}
 render(<Form/>);
 const field=screen.getByLabelText('Executable .lang program');fireEvent.change(field,{target:{value:'print 42;'}});fireEvent.blur(field);
 expect(saved!.steps![0].config!.program).toBe('print 42;');
 const data=screen.getByLabelText('Resource data (JSON)');fireEvent.change(data,{target:{value:'{"inputs":["customer source"]}'}});fireEvent.blur(data);
 expect(saved!.steps![0].config!.resources).toEqual({inputs:['customer source']});
 fireEvent.change(data,{target:{value:'not json'}});fireEvent.blur(data);expect(screen.getByRole('alert').textContent).toContain('JSON object');expect(saved!.steps![0].config!.resources).toEqual({inputs:['customer source']});
});

test('natural-language draft fills source without replacing independent resources',async()=>{
 let saved:WorkflowDefinition;
 const initial={workflow_id:'drafting',steps:[{step_id:'code',type:'lang_execution',config:{...defaultConfig('lang_execution'),resources:{tests:[{program:'print 1;',expected_stdout:'1\n'}]}}}]} as WorkflowDefinition;
 function Form(){const [d,set]=useState(initial);saved=d;return <LanguageStepInspector contextId="drafting" step={d.steps![0]} bodyOf={null} refs={[]} edit={fn=>set(old=>{const n=structuredClone(old);fn(n);return n;})}/>;}
 render(<Form/>);const input=screen.getByLabelText('Describe the program');fireEvent.change(input,{target:{value:'Print the answer'}});fireEvent.blur(input);fireEvent.click(screen.getByText('Draft executable program'));
 await waitFor(()=>expect(saved!.steps![0].config!.program).toBe('print 42;'));
 expect(saved!.steps![0].config!.resources).toEqual({tests:[{program:'print 1;',expected_stdout:'1\n'}]});
});

test('exact recall selector keeps customer hashes and requires verified cases',()=>{
 let saved:WorkflowDefinition;
 const initial={workflow_id:'reuse',steps:[{step_id:'recall',type:'lang_recall',config:{query_template:'customer requirement'}}]} as WorkflowDefinition;
 function Form(){const [d,set]=useState(initial);saved=d;return <LanguageStepInspector step={d.steps![0]} bodyOf={null} refs={[]} edit={fn=>set(old=>{const n=structuredClone(old);fn(n);return n;})}/>;}
 render(<Form/>);fireEvent.click(screen.getByLabelText('Require exact verified candidate'));
 for(const [label,value] of [['Candidate source SHA-256','a'.repeat(64)],['Verification definition SHA-256','b'.repeat(64)],['Repository provenance SHA-256 (optional)','c'.repeat(64)]]){const field=screen.getByLabelText(label);fireEvent.change(field,{target:{value}});fireEvent.blur(field);}
 expect(saved!.steps![0].config!.verified_only).toBe(true);
 expect(saved!.steps![0].config!.match).toEqual({source_sha256:'a'.repeat(64),definition_sha256:'b'.repeat(64),repository_sha256:'c'.repeat(64)});
 fireEvent.click(screen.getByLabelText('Require exact verified candidate'));expect(saved!.steps![0].config!).not.toHaveProperty('match');
});
