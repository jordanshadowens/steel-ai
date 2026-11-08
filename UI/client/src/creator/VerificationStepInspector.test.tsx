import {useState} from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,expect,test} from 'vitest';
import {VerificationStepInspector} from './VerificationStepInspector';
import type {WorkflowDefinition} from '../api/contracts';
afterEach(cleanup);
test('customer changes expected answers through fields and persisted definition follows edits',()=>{
 let saved:WorkflowDefinition;
 const initial={workflow_id:'testing',version:1,status:'draft',inputs:[],outputs:{},limits:{max_rounds:5,max_iterations:1},steps:[{step_id:'verify',type:'skill_verification',name:'Verify',config:{skill:{from:'candidate'},cases:[{inputs:{quantity:2},expected:4}]},on_success:'end'}]} as WorkflowDefinition;
 function Form(){const [definition,setDefinition]=useState(initial);saved=definition;return <VerificationStepInspector step={definition.steps![0]} bodyOf={null} refs={[]} edit={fn=>setDefinition(old=>{const next=structuredClone(old);fn(next);return next;})}/>;}
 render(<Form/>);
 fireEvent.change(screen.getByLabelText('Example 1: expected answer'),{target:{value:'6'}});
 fireEvent.click(screen.getByText('Add example'));
 fireEvent.change(screen.getByLabelText('Example 2: quantity'),{target:{value:'3'}});
 fireEvent.change(screen.getByLabelText('Example 2: expected answer'),{target:{value:'9'}});
 expect((saved!.steps![0].config as any).cases).toEqual([{inputs:{quantity:2},expected:6},{inputs:{quantity:3},expected:9}]);
 fireEvent.click(screen.getByText('Remove example 1'));
 expect((saved!.steps![0].config as any).cases).toEqual([{inputs:{quantity:3},expected:9}]);
});
