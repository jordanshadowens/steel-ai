import { useEffect, useRef, useState, type RefObject } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import {
  Background,
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
import type { Definition } from './cloud';
import '@xyflow/react/dist/style.css';

type MapNode = Node<
  {
    name: string;
    kind: string;
    compact: boolean;
    current?: boolean;
    active?: boolean;
  },
  'workflowStep'
>;
const finish = '__steel_workflow_finish__';

function StepNode({ data }: NodeProps<MapNode>) {
  return (
    <div className="map-step" aria-current={data.current ? 'step' : undefined}>
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
          layoutId="run-beacon"
          className="run-beacon"
          aria-hidden="true"
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        />
      )}
      <strong>{data.name}</strong>
      <small>{data.kind.replaceAll('_', ' ')}</small>
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
}: {
  definition: Definition;
  current?: string | null;
  active?: string | null;
  runId: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [compact, setCompact] = useState(
    () => matchMedia('(max-width: 620px)').matches,
  );
  useEffect(() => {
    const screen = matchMedia('(max-width: 620px)');
    const onChange = (event: MediaQueryListEvent) => setCompact(event.matches);
    screen.addEventListener('change', onChange);
    return () => screen.removeEventListener('change', onChange);
  }, []);
  const steps = definition.steps ?? [];
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
      current: step.step_id === current,
      active: step.step_id === active,
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
      const color = labels.includes('Failure') ? '#f5a7a5' : '#94c5af';
      const label = labels.join(' / ');
      const branch = target !== routes[0].target;
      edges.push({
        id: JSON.stringify([step.step_id, target]),
        source: step.step_id,
        target: target === 'end' ? finish : target,
        sourceHandle: branch ? 'branch-out' : undefined,
        targetHandle: branch ? 'branch-in' : undefined,
        label: label === 'Success' ? undefined : label,
        ariaLabel: label + ' from ' + step.step_id + ' to ' + target,
        style: { stroke: color },
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
      data: { name: 'Finish', kind: 'End', compact },
    });
  }
  if (!nodes.length) {
    return <p>No workflow steps available.</p>;
  }
  return (
    <div className="run-map" role="region" aria-label="Workflow map" ref={frame}>
      <label className="run-map-follow">
        <input type="checkbox" checked={following} onChange={event => setFollowing(event.target.checked)} />
        Follow active step
      </label>
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
          <Background gap={18} size={1} />
          <Controls showInteractive={false} />
          {following && <FollowStep stepId={active} frame={frame} />}
        </ReactFlow>
      </LayoutGroup>
    </div>
  );
}
