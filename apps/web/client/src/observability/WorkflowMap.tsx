import { useEffect, useRef, useState, type RefObject } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import {
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type { Definition, Entry } from './cloud';
import '@xyflow/react/dist/style.css';

type MapNode = Node<
  {
    name: string;
    kind: string;
    compact: boolean;
    current?: boolean;
    active?: boolean;
    status?: string;
    selected?: boolean;
    inspect?: () => void;
  },
  'workflowStep'
>;
const finish = '__steel_workflow_finish__';

function StepNode({ data }: NodeProps<MapNode>) {
  const reduced = useReducedMotion();
  return (
    <div className="map-step" data-state={data.status} aria-current={data.current ? 'step' : undefined}>
      <Handle
        type="target"
        position={data.compact ? Position.Top : Position.Left}
      />
      <Handle
        id="branch-in"
        className="branch-handle"
        type="target"
        position={data.compact ? Position.Right : Position.Top}
      />
      {data.active && (
        <motion.span
          layoutId={reduced ? undefined : 'run-beacon'}
          className="run-beacon"
          aria-hidden="true"
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        />
      )}
      {data.inspect ? (
        <button className="nodrag nopan map-step-target" type="button" aria-pressed={!!data.selected} onClick={data.inspect}>
          <strong>{data.name}</strong>
          <small>{data.status}</small>
        </button>
      ) : <><strong>{data.name}</strong><small>{data.kind}</small></>}
      <Handle
        type="source"
        position={data.compact ? Position.Bottom : Position.Right}
      />
      <Handle
        id="branch-out"
        className="branch-handle"
        type="source"
        position={data.compact ? Position.Right : Position.Top}
      />
    </div>
  );
}

const nodeTypes = { workflowStep: StepNode };

function FollowStep({stepId, frame}: {
  stepId?: string | null;
  frame: RefObject<HTMLDivElement | null>;
}) {
  const flow = useReactFlow<MapNode>();
  const ready = useNodesInitialized();
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!ready || !stepId) return;
    const id = requestAnimationFrame(() => {
      const node = flow.getNode(stepId);
      const pane = frame.current;
      if (!node || !pane) return;
      const cx = node.position.x + (node.measured?.width ?? 185) / 2;
      const cy = node.position.y + (node.measured?.height ?? 56) / 2;
      const {x, y, zoom} = flow.getViewport();
      if (cx * zoom + x < 45 || cx * zoom + x > pane.clientWidth - 45 ||
          cy * zoom + y < 45 || cy * zoom + y > pane.clientHeight - 45) {
        void flow.setCenter(cx, cy, {zoom, duration: reduced ? 0 : 350});
      }
    });
    return () => cancelAnimationFrame(id);
  }, [flow, frame, ready, reduced, stepId]);
  return null;
}

export default function WorkflowMap({
  definition,
  current,
  active,
  runId,
  events,
  selected,
  onSelect,
}: {
  definition: Definition;
  current?: string | null;
  active?: string | null;
  runId: string;
  events?: Entry[];
  selected?: string;
  onSelect: (step?: string) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [following, setFollowing] = useState(true);
  const [replayIndex, setReplayIndex] = useState<number>();
  const [compact, setCompact] = useState(
    () => matchMedia('(max-width: 620px)').matches,
  );
  useEffect(() => {
    const container = frame.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 650));
    observer.observe(container);
    return () => observer.disconnect();
  }, [definition.steps?.length]);
  const steps = definition.steps ?? [];
  const recordedSteps = (events ?? [])
    .filter(entry => entry.kind === 'run' && ['running','local_running'].includes(entry.status ?? '') && entry.step_id)
    .map(entry => entry.step_id!);
  const reachedObjective = (events ?? []).some(entry => entry.kind === 'run' && ['sealed','local_completed'].includes(entry.status ?? ''));
  const replayRoute = reachedObjective ? [...recordedSteps, finish] : recordedSteps;
  const replayCount = replayRoute.length;
  const replay = replayIndex === undefined ? undefined : replayRoute[replayIndex];
  const beaconStep = replay ?? active;
  useEffect(() => {
    if (replayIndex === undefined) return;
    const timer = window.setTimeout(() => {
      setReplayIndex(replayIndex + 1 < replayCount ? replayIndex + 1 : undefined);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [replayIndex, replayCount]);
  const stepStatus = new Map<string, string>();
  const traversed = new Set<string>();
  const replayed = new Set<string>();
  if (replayIndex !== undefined) {
    for (let index = 1; index <= replayIndex; index++) {
      replayed.add(JSON.stringify([replayRoute[index - 1], replayRoute[index] === finish ? 'end' : replayRoute[index]]));
    }
  }
  let lastStep: string | null = null;
  for (const entry of events ?? []) {
    if (entry.kind !== 'run') continue;
    if (['running','local_running'].includes(entry.status ?? '') && entry.step_id !== lastStep) {
      if (lastStep && entry.step_id) traversed.add(JSON.stringify([lastStep, entry.step_id]));
      if (entry.step_id) lastStep = entry.step_id;
    }
    if (['sealed','local_completed'].includes(entry.status ?? '') && lastStep) traversed.add(JSON.stringify([lastStep, 'end']));
    if (!entry.step_id || !entry.status) continue;
    if (entry.status === 'step_completed') stepStatus.set(entry.step_id, 'Completed');
    if (entry.status === 'step_failed') stepStatus.set(entry.step_id, 'Failed');
  }
  const nodes: MapNode[] = steps.map((step, index) => ({
    id: step.step_id,
    type: 'workflowStep',
    position: compact
      ? { x: 0, y: index * 112 }
      : (definition.ui?.positions?.[step.step_id] ?? { x: index * 255, y: 0 }),
    ariaLabel: step.name || step.step_id,
    data: {
      name: step.name || step.step_id,
      kind: step.type,
      compact,
      current: step.step_id === (replay ?? current),
      active: step.step_id === beaconStep,
      status: step.step_id === beaconStep ? (replay ? 'Replay' : 'Live') : (stepStatus.get(step.step_id) ?? (step.step_id === current ? 'Current' : 'Pending')),
      selected: step.step_id === selected,
      inspect: () => onSelect(step.step_id === selected ? undefined : step.step_id),
    },
  }));
  const known = new Set(steps.map((step) => step.step_id));
  const edges: Edge[] = [];
  for (const step of steps) {
    const routes = [
      {
        target: step.on_success || 'end',
        label: step.type === 'conditional_routing' ? 'Fallback' : 'Success',
      },
    ];
    if (step.on_failure) {
      routes.push({ target: step.on_failure, label: 'Failure' });
    }
    if (
      step.type === 'conditional_routing' &&
      Array.isArray(step.config?.rules)
    ) {
      step.config.rules.forEach((rule, index) => {
        if (typeof rule?.goto === 'string' && rule.goto) {
          routes.push({ target: rule.goto, label: 'Rule ' + (index + 1) });
        }
      });
    }
    const labelsByTarget = new Map<string, string[]>();
    for (const { target, label } of routes) {
      if (target === 'end' || known.has(target)) {
        labelsByTarget.set(target, [
          ...(labelsByTarget.get(target) ?? []),
          label,
        ]);
      }
    }
    for (const [target, labels] of labelsByTarget) {
      const edgeId = JSON.stringify([step.step_id, target]);
      const visited = (replay ? replayed : traversed).has(edgeId);
      const color = labels.includes('Failure') ? '#f5a7a5' : visited ? '#83fbc0' : '#72968e';
      const label = labels.join(' / ');
      const branch = target !== routes[0].target;
      const fromLive = (target === 'end' ? finish : target) === beaconStep && visited;
      edges.push({
        id: edgeId,
        source: step.step_id,
        target: target === 'end' ? finish : target,
        sourceHandle: branch ? 'branch-out' : undefined,
        targetHandle: branch ? 'branch-in' : undefined,
        label: label === 'Success' ? undefined : label,
        ariaLabel: label + ' from ' + step.step_id + ' to ' + target,
        animated: fromLive && !reduced,
        style: { stroke: color, strokeWidth: visited ? 2.5 : 1.4 },
        markerEnd: { type: MarkerType.ArrowClosed, color },
      });
    }
  }
  if (edges.some((edge) => edge.target === finish)) {
    nodes.push({
      id: finish,
      type: 'workflowStep',
      position: compact
        ? { x: 0, y: steps.length * 112 }
        : { x: Math.max(...nodes.map((node) => node.position.x)) + 255, y: 0 },
      data: {
        name: 'Objective',
        kind: definition.objective || definition.name || 'Workflow finish',
        compact,
        status: 'Objective',
        current: beaconStep === finish,
        active: beaconStep === finish,
      },
    });
  }
  if (!nodes.length) {
    return <p>No workflow steps available.</p>;
  }
  return (
    <div className="run-map" role="region" aria-label="Workflow map" ref={frame}>
      <div className="run-map-toolbar">
        {!active && recordedSteps.length > 0 && (
          <button type="button" className="run-link" onClick={() => setReplayIndex(replayIndex === undefined ? 0 : undefined)}>
            {replayIndex === undefined ? 'Replay route' : 'Stop replay'}
          </button>
        )}
        <label className="run-map-follow">
          <input type="checkbox" checked={following} onChange={event => setFollowing(event.target.checked)} />
          Follow beacon
        </label>
      </div>
      <LayoutGroup id={runId}>
        <ReactFlow
          key={compact ? 'vertical' : 'horizontal'}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          fitView
          colorMode="dark"
          fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
        >
          <Controls showInteractive={false} />
          {following && <FollowStep stepId={beaconStep} frame={frame} />}
        </ReactFlow>
      </LayoutGroup>
    </div>
  );
}
