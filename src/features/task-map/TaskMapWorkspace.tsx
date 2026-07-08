import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, Controls, Handle, Position, ReactFlow, applyNodeChanges, type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createTaskBreakdown, createTaskSchedule, type TaskMapBreakdownItem, type TaskMapScheduleItem } from "../../lib/core-api";
import "./task-map.css";

type Language = "zh" | "en";

interface TaskNode {
  id: string;
  parentId?: string;
  title: string;
  note?: string;
  startDay: number;
  endDay: number;
  lane: number;
  collapsed?: boolean;
  dependsOn?: string[];
}

type DragState = {
  id: string;
  mode: "move" | "start" | "end";
  startX: number;
  originalStart: number;
  originalEnd: number;
};

type TaskPhase = "structure" | "timeline";

type MindNodeData = {
  task: TaskNode;
  depth: number;
  hasChildren: boolean;
  selected: boolean;
  busy: boolean;
  root: boolean;
  onSelect: (id: string) => void;
  onAddChild: (id: string) => void;
  onAiBreakdown: (id: string) => void;
  onToggle: (id: string) => void;
};

type MindEdgeData = {
  depth: number;
  active: boolean;
};

type ContextMenuState = {
  x: number;
  y: number;
} | null;

const storageKey = "muyang-task-map-project-v1";
const dayWidth = 34;
const minDuration = 2;

const seedTasks: TaskNode[] = [
  { id: "goal", title: "考研上岸", note: "总目标只能有一个，所有任务都围绕它继续细化。", startDay: 0, endDay: 119, lane: 0 },
  { id: "math", parentId: "goal", title: "数学系统复习", note: "先补概念，再做题型和真题。", startDay: 4, endDay: 72, lane: 0 },
  { id: "english", parentId: "goal", title: "英语稳定提分", note: "词汇、阅读和作文分开推进。", startDay: 0, endDay: 94, lane: 1 },
  { id: "major", parentId: "goal", title: "专业课框架搭建", note: "按章节建立知识树。", startDay: 12, endDay: 86, lane: 2 },
  { id: "mock", parentId: "goal", title: "真题模考与复盘", note: "后期用整套卷校准节奏。", startDay: 76, endDay: 118, lane: 0, dependsOn: ["math", "english", "major"] },
];

function loadInitialTasks(): TaskNode[] {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return seedTasks;
    const parsed = JSON.parse(saved) as TaskNode[];
    return Array.isArray(parsed) && parsed.length ? parsed : seedTasks;
  } catch {
    return seedTasks;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createId(prefix = "task") {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

function formatDay(day: number) {
  return `D+${String(Math.max(0, Math.round(day))).padStart(2, "0")}`;
}

function fallbackBreakdown(task: TaskNode): TaskMapBreakdownItem[] {
  const title = task.title || "当前任务";
  return [
    { title: `${title} - 明确目标与边界`, note: "先定义完成标准、产出物和不做的内容。" },
    { title: `${title} - 拆出关键模块`, note: "把任务拆成能独立推进的几个部分。" },
    { title: `${title} - 建立执行顺序`, note: "标记哪些任务必须先做，哪些可以并行。" },
    { title: `${title} - 复盘与收束`, note: "安排检查点，及时修正偏差。" },
  ];
}

function distributeSchedule(parent: TaskNode, children: TaskNode[]): TaskMapScheduleItem[] {
  const total = Math.max(minDuration * children.length, parent.endDay - parent.startDay + 1);
  const step = Math.max(minDuration + 1, Math.floor(total / Math.max(1, children.length)));
  return children.map((child, index) => {
    const startDay = clamp(parent.startDay + index * step, parent.startDay, parent.endDay - minDuration);
    const endDay = index === children.length - 1
      ? parent.endDay
      : clamp(startDay + step + 2, startDay + minDuration, parent.endDay);
    return {
      id: child.id,
      startDay,
      endDay,
      lane: index === children.length - 1 ? Math.max(0, index - 1) : index,
      dependsOn: index > 0 ? [children[index - 1].id] : [],
      note: child.note,
    };
  });
}

function taskInput(task: TaskNode) {
  return { id: task.id, parentId: task.parentId, title: task.title, note: task.note };
}

function taskDepth(task: TaskNode, tasks: TaskNode[]) {
  let depth = 0;
  let cursor = task;
  while (cursor.parentId) {
    const parent = tasks.find((item) => item.id === cursor.parentId);
    if (!parent) break;
    depth += 1;
    cursor = parent;
  }
  return depth;
}

function collectVisibleTaskRows(root: TaskNode | undefined, childrenByParent: Map<string, TaskNode[]>) {
  const rows: Array<TaskNode & { depth: number }> = [];
  const walk = (task: TaskNode, depth: number) => {
    rows.push({ ...task, depth });
    if (task.collapsed) return;
    (childrenByParent.get(task.id) ?? []).forEach((child) => walk(child, depth + 1));
  };
  if (root) walk(root, 0);
  return rows;
}

function createStandardMindLayout(rows: Array<TaskNode & { depth: number }>) {
  const depthCounts = new Map<number, number>();
  const positions: Record<string, { x: number; y: number }> = {};
  rows.forEach((task) => {
    const count = depthCounts.get(task.depth) ?? 0;
    depthCounts.set(task.depth, count + 1);
    positions[task.id] = {
      x: task.depth * 340,
      y: count * 112,
    };
  });
  return positions;
}

const MindMapNode = memo(function MindMapNode({ data }: NodeProps<Node<MindNodeData>>) {
  const canAiSplit = !data.hasChildren;
  return (
    <article className={`mind-node depth-${Math.min(data.depth, 3)}${data.selected ? " selected" : ""}${data.root ? " root" : ""}`}>
      {data.depth > 0 ? <Handle className="mind-handle target" type="target" position={Position.Left} /> : null}
      <div
        className="mind-node-main"
        role="button"
        tabIndex={0}
        onClick={() => data.onSelect(data.task.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") data.onSelect(data.task.id);
        }}
      >
        <span>{data.root ? "ROOT" : `L${data.depth}`}</span>
        <strong>{data.task.title}</strong>
        {data.task.note ? <small>{data.task.note}</small> : null}
      </div>
      <div className="mind-node-actions">
        {data.hasChildren ? (
          <button className="nodrag" type="button" onClick={(event) => { event.stopPropagation(); data.onToggle(data.task.id); }} title={data.task.collapsed ? "展开子任务" : "收起子任务"}>
            {data.task.collapsed ? "+" : "-"}
          </button>
        ) : null}
        <button className="nodrag" type="button" onClick={(event) => { event.stopPropagation(); data.onAddChild(data.task.id); }} title="新增子任务">+</button>
        <button className="nodrag" type="button" onClick={(event) => { event.stopPropagation(); data.onAiBreakdown(data.task.id); }} disabled={!canAiSplit || data.busy} title={canAiSplit ? "AI 拆解当前节点" : "已有子任务的节点不能重复 AI 拆解"}>
          AI
        </button>
      </div>
      <Handle className="mind-handle source" type="source" position={Position.Right} />
    </article>
  );
});

function nodeRedBezierPath(sourceX: number, sourceY: number, targetX: number, targetY: number) {
  const distance = Math.abs(targetX - sourceX);
  const level = clamp(distance / 2, 75, 180);
  const direction = targetX >= sourceX ? 1 : -1;
  const c1x = sourceX + level * direction;
  const c2x = targetX - level * direction;
  return `M ${sourceX} ${sourceY} C ${c1x} ${sourceY}, ${c2x} ${targetY}, ${targetX} ${targetY}`;
}

function MindBezierEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<Edge<MindEdgeData>>) {
  const depth = data?.depth ?? 1;
  const active = Boolean(data?.active);
  const path = nodeRedBezierPath(sourceX, sourceY, targetX, targetY);

  return (
    <g className={`mind-bezier-edge depth-${Math.min(depth, 3)}${active ? " active" : ""}`}>
      <path className="mind-bezier-hit" d={path} />
      <path className="mind-bezier-glow" d={path} />
      <path className="mind-bezier-line" d={path} />
      <circle className="mind-bezier-knot source" cx={sourceX} cy={sourceY} r={3.2} />
      <circle className="mind-bezier-knot target" cx={targetX} cy={targetY} r={3.2} />
    </g>
  );
}

const mindNodeTypes = { mindTask: MindMapNode };
const mindEdgeTypes = { mindBezier: MindBezierEdge };

export function TaskMapWorkspace({ language, onLanguageChange, onOpenHome, onOpenLiveSticker }: { language: Language; onLanguageChange: (language: Language) => void; onOpenHome: () => void; onOpenLiveSticker: () => void }) {
  const isEnglish = language === "en";
  const [tasks, setTasks] = useState<TaskNode[]>(loadInitialTasks);
  const [selectedId, setSelectedId] = useState("goal");
  const [phase, setPhase] = useState<TaskPhase>("structure");
  const [mindFlowNodes, setMindFlowNodes] = useState<Node<MindNodeData>[]>([]);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [mindContextMenu, setMindContextMenu] = useState<ContextMenuState>(null);
  const [viewStart, setViewStart] = useState(0);
  const [viewLength, setViewLength] = useState(120);
  const [message, setMessage] = useState(isEnglish ? "Ready." : "已就绪。");
  const [isBusy, setIsBusy] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);

  const root = tasks.find((task) => !task.parentId) ?? tasks[0];
  const selected = tasks.find((task) => task.id === selectedId) ?? root;
  const childrenByParent = useMemo(() => {
    const map = new Map<string, TaskNode[]>();
    tasks.forEach((task) => {
      if (!task.parentId) return;
      const list = map.get(task.parentId) ?? [];
      list.push(task);
      map.set(task.parentId, list);
    });
    return map;
  }, [tasks]);

  const visibleTasks = useMemo(() => collectVisibleTaskRows(root, childrenByParent), [childrenByParent, root]);

  const totalEnd = Math.max(...tasks.map((task) => task.endDay), 120);
  const timelineDays = Array.from({ length: viewLength }, (_, index) => viewStart + index);

  const persist = (nextTasks: TaskNode[]) => {
    setTasks(nextTasks);
    window.localStorage.setItem(storageKey, JSON.stringify(nextTasks));
  };

  const updateTask = (id: string, patch: Partial<TaskNode>) => {
    persist(tasks.map((task) => task.id === id ? { ...task, ...patch } : task));
  };

  const addChild = (parent = selected) => {
    const children = childrenByParent.get(parent.id) ?? [];
    const startDay = clamp(parent.startDay + children.length * 4, parent.startDay, parent.endDay - minDuration);
    const next: TaskNode = {
      id: createId(),
      parentId: parent.id,
      title: isEnglish ? "New subtask" : "新的子任务",
      note: "",
      startDay,
      endDay: clamp(startDay + 12, startDay + minDuration, parent.endDay),
      lane: children.length,
    };
    persist([...tasks, next]);
    setSelectedId(next.id);
    setNodePositions((positions) => ({
      ...positions,
      [next.id]: positions[next.id] ?? {
        x: (taskDepth(parent, tasks) + 1) * 310,
        y: (visibleTasks.findIndex((task) => task.id === parent.id) + Math.max(1, children.length + 1)) * 96,
      },
    }));
  };

  const addChildById = useCallback((parentId: string) => {
    const parent = tasks.find((task) => task.id === parentId);
    if (parent) addChild(parent);
  }, [tasks, childrenByParent, isEnglish, selected, visibleTasks]);

  const removeTask = (id: string) => {
    if (id === root.id) {
      setMessage(isEnglish ? "The root goal cannot be deleted." : "总目标不能删除。");
      return;
    }
    const ids = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      tasks.forEach((task) => {
        if (task.parentId && ids.has(task.parentId) && !ids.has(task.id)) {
          ids.add(task.id);
          changed = true;
        }
      });
    }
    persist(tasks.filter((task) => !ids.has(task.id)).map((task) => ({
      ...task,
      dependsOn: task.dependsOn?.filter((dependency) => !ids.has(dependency)),
    })));
    setSelectedId(root.id);
  };

  const resetProject = () => {
    persist(seedTasks);
    setSelectedId("goal");
    setViewStart(0);
    setViewLength(120);
    setMessage(isEnglish ? "Sample project restored." : "已恢复考研示例项目。");
  };

  const createAiBreakdown = async (target = selected) => {
    if (!target) return;
    setSelectedId(target.id);
    if ((childrenByParent.get(target.id) ?? []).length) {
      setMessage(isEnglish ? "AI breakdown only works on leaf nodes." : "AI 拆解只对没有子任务的节点生效。");
      return;
    }
    setIsBusy(true);
    try {
      const ancestors: TaskNode[] = [];
      let cursor = target;
      while (cursor.parentId) {
        const parent = tasks.find((task) => task.id === cursor.parentId);
        if (!parent) break;
        ancestors.unshift(parent);
        cursor = parent;
      }
      const siblings = tasks.filter((task) => task.parentId === target.parentId && task.id !== target.id);
      const result = await createTaskBreakdown({
        task: taskInput(target),
        ancestors: ancestors.map(taskInput),
        siblings: siblings.map(taskInput),
        locale: language,
      });
      mergeBreakdown(result.items.length ? result.items : fallbackBreakdown(target), result.provider, target);
    } catch (error) {
      mergeBreakdown(fallbackBreakdown(target), "local-fallback", target);
      setMessage(isEnglish ? "Core unavailable, local breakdown inserted." : "Core 暂不可用，已插入本地拆分建议。");
    } finally {
      setIsBusy(false);
    }
  };

  const createAiBreakdownById = useCallback((taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (task) void createAiBreakdown(task);
  }, [tasks, childrenByParent, language, isEnglish]);

  const mergeBreakdown = (items: TaskMapBreakdownItem[], provider: string, parent = selected) => {
    const safeItems = items.slice(0, 6).filter((item) => item.title?.trim());
    const span = Math.max(minDuration * safeItems.length, parent.endDay - parent.startDay + 1);
    const step = Math.max(minDuration + 1, Math.floor(span / Math.max(1, safeItems.length)));
    const children = safeItems.map((item, index): TaskNode => {
      const startDay = clamp(parent.startDay + index * step, parent.startDay, parent.endDay - minDuration);
      return {
        id: createId("ai"),
        parentId: parent.id,
        title: item.title.trim(),
        note: item.note?.trim(),
        startDay,
        endDay: clamp(index === safeItems.length - 1 ? parent.endDay : startDay + step + 2, startDay + minDuration, parent.endDay),
        lane: index,
        dependsOn: index > 0 ? [] : undefined,
      };
    });
    persist([...tasks, ...children]);
    const parentDepth = taskDepth(parent, tasks);
    const parentRow = Math.max(0, visibleTasks.findIndex((task) => task.id === parent.id));
    setNodePositions((positions) => ({
      ...positions,
      ...Object.fromEntries(children.map((child, index) => [child.id, {
        x: (parentDepth + 1) * 310,
        y: (parentRow + index + 1) * 96,
      }])),
    }));
    setMessage(isEnglish ? `Inserted ${children.length} subtasks via ${provider}.` : `已通过 ${provider} 插入 ${children.length} 个子任务。`);
  };

  const scheduleChildren = async () => {
    const children = childrenByParent.get(selected.id) ?? [];
    if (!children.length) {
      setMessage(isEnglish ? "Select a task with children first." : "请先选择一个已有子任务的节点。");
      return;
    }
    setIsBusy(true);
    try {
      const result = await createTaskSchedule({
        parent: { ...taskInput(selected), startDay: selected.startDay, endDay: selected.endDay },
        children: children.map((child) => ({ ...taskInput(child), startDay: child.startDay, endDay: child.endDay, lane: child.lane })),
        locale: language,
      });
      applySchedule(result.items.length ? result.items : distributeSchedule(selected, children), result.provider);
    } catch {
      applySchedule(distributeSchedule(selected, children), "local-fallback");
      setMessage(isEnglish ? "Core unavailable, local schedule applied." : "Core 暂不可用，已应用本地时间初排。");
    } finally {
      setIsBusy(false);
    }
  };

  const applySchedule = (items: TaskMapScheduleItem[], provider: string) => {
    const byId = new Map(items.map((item) => [item.id, item]));
    persist(tasks.map((task) => {
      const item = byId.get(task.id);
      if (!item) return task;
      return {
        ...task,
        startDay: clamp(Math.round(item.startDay), selected.startDay, selected.endDay - minDuration),
        endDay: clamp(Math.round(item.endDay), Math.round(item.startDay) + minDuration, selected.endDay),
        lane: Math.max(0, Math.round(item.lane)),
        dependsOn: item.dependsOn?.filter((id) => id !== task.id),
        note: item.note || task.note,
      };
    }));
    setMessage(isEnglish ? `Schedule updated via ${provider}.` : `已通过 ${provider} 初排时间。`);
  };

  const beginDrag = (event: React.PointerEvent, task: TaskNode, mode: DragState["mode"]) => {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDrag({ id: task.id, mode, startX: event.clientX, originalStart: task.startDay, originalEnd: task.endDay });
  };

  const moveDrag = (event: React.PointerEvent) => {
    if (!drag) return;
    const delta = Math.round((event.clientX - drag.startX) / dayWidth);
    const task = tasks.find((item) => item.id === drag.id);
    if (!task) return;
    const parent = task.parentId ? tasks.find((item) => item.id === task.parentId) : undefined;
    const minStart = parent?.startDay ?? 0;
    const maxEnd = parent?.endDay ?? totalEnd;
    let startDay = drag.originalStart;
    let endDay = drag.originalEnd;
    if (drag.mode === "start") {
      startDay = clamp(drag.originalStart + delta, minStart, drag.originalEnd - minDuration);
    } else if (drag.mode === "end") {
      endDay = clamp(drag.originalEnd + delta, drag.originalStart + minDuration, maxEnd);
    } else {
      const duration = drag.originalEnd - drag.originalStart;
      startDay = clamp(drag.originalStart + delta, minStart, maxEnd - duration);
      endDay = startDay + duration;
    }
    setTasks(tasks.map((item) => item.id === task.id ? { ...item, startDay, endDay } : item));
  };

  const endDrag = () => {
    if (drag) {
      window.localStorage.setItem(storageKey, JSON.stringify(tasks));
      setDrag(null);
    }
  };

  const toggleTaskById = useCallback((taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (task) updateTask(taskId, { collapsed: !task.collapsed });
  }, [tasks]);

  useEffect(() => {
    setMindFlowNodes((currentNodes) => {
      const currentById = new Map(currentNodes.map((node) => [node.id, node]));
      return visibleTasks.map((task, index) => {
        const current = currentById.get(task.id);
        const fallbackPosition = { x: task.depth * 310, y: index * 96 };
        return {
          ...current,
          id: task.id,
          type: "mindTask",
          position: current?.position ?? nodePositions[task.id] ?? fallbackPosition,
          data: {
            task,
            depth: task.depth,
            hasChildren: Boolean((childrenByParent.get(task.id) ?? []).length),
            selected: task.id === selected.id,
            busy: isBusy,
            root: task.id === root.id,
            onSelect: setSelectedId,
            onAddChild: addChildById,
            onAiBreakdown: createAiBreakdownById,
            onToggle: toggleTaskById,
          },
          draggable: true,
        };
      });
    });
  }, [visibleTasks, nodePositions, childrenByParent, selected.id, isBusy, root.id, addChildById, createAiBreakdownById, toggleTaskById]);

  const handleMindNodesChange = useCallback((changes: NodeChange<Node<MindNodeData>>[]) => {
    setMindFlowNodes((nodes) => applyNodeChanges(changes, nodes));
  }, []);

  const mindEdges = useMemo<Edge[]>(() => visibleTasks
    .filter((task) => task.parentId && visibleTasks.some((item) => item.id === task.parentId))
    .map((task) => ({
      id: `${task.parentId}-${task.id}`,
      source: task.parentId ?? "",
      target: task.id,
      type: "mindBezier",
      data: { depth: task.depth, active: task.id === selected.id },
      className: `mind-edge depth-${Math.min(task.depth, 3)}`,
    })), [visibleTasks, selected.id]);

  const keepMindNodePosition = useCallback((node: Node) => {
    setNodePositions((positions) => ({
      ...positions,
      [node.id]: node.position,
    }));
  }, []);

  const formatMindLayout = useCallback(() => {
    const nextPositions = createStandardMindLayout(visibleTasks);
    setNodePositions(nextPositions);
    setMindFlowNodes((nodes) => nodes.map((node) => ({
      ...node,
      position: nextPositions[node.id] ?? node.position,
    })));
    setMindContextMenu(null);
    setMessage(isEnglish ? "Mind map layout formatted." : "思维导图已一键格式化。");
  }, [visibleTasks, isEnglish]);

  const openMindContextMenu = useCallback((event: MouseEvent | React.MouseEvent<Element, MouseEvent>) => {
    event.preventDefault();
    setMindContextMenu({ x: event.clientX, y: event.clientY });
  }, []);

  return (
    <div className="task-map-shell">
      <header className="task-map-header">
        <div>
          <p>MUYANG TASK MAP</p>
          <h1>{isEnglish ? "AI Task Gantt Studio" : "AI 任务甘特图工作台"}</h1>
        </div>
        <div className="task-map-header-actions">
          <button type="button" onClick={onOpenHome}>{isEnglish ? "Toolkit" : "工具主页"}</button>
          <button type="button" onClick={onOpenLiveSticker}>{isEnglish ? "Live Sticker" : "直播贴片"}</button>
          <div className="task-language-switcher" role="group" aria-label="language">
            <button className={language === "zh" ? "selected" : ""} type="button" onClick={() => onLanguageChange("zh")}>中</button>
            <button className={language === "en" ? "selected" : ""} type="button" onClick={() => onLanguageChange("en")}>EN</button>
          </div>
        </div>
      </header>

      <main className="task-map-main">
        <section className="task-map-hero">
          <p>01 / STRUCTURE FIRST</p>
          <h2>{isEnglish ? "One goal, infinite decomposition, then time planning." : "一个总目标，无限拆解，再进入时间规划。"}</h2>
          <span>{message}</span>
        </section>

        <nav className="task-phase-switch" aria-label={isEnglish ? "Task map phase" : "任务规划阶段"}>
          <button className={phase === "structure" ? "selected" : ""} type="button" onClick={() => setPhase("structure")}>
            <span>01</span>{isEnglish ? "Structure map" : "结构拆解"}
          </button>
          <button className={phase === "timeline" ? "selected" : ""} type="button" onClick={() => setPhase("timeline")}>
            <span>02</span>{isEnglish ? "Timeline" : "时间规划"}
          </button>
        </nav>

        {phase === "structure" ? (
          <section className="task-map-structure-workbench">
            <section className="mind-map-panel">
              <div className="task-panel-title">
                <span>{isEnglish ? "Mind Map / Logic" : "思维导图 / 逻辑关系"}</span>
                <div className="task-map-range">
                  <button type="button" onClick={resetProject}>{isEnglish ? "Reset" : "恢复示例"}</button>
                </div>
              </div>
              <div className="mind-map-canvas">
                <ReactFlow
                  nodes={mindFlowNodes}
                  edges={mindEdges}
                  nodeTypes={mindNodeTypes}
                  edgeTypes={mindEdgeTypes}
                  fitView
                  fitViewOptions={{ padding: 0.22 }}
                  minZoom={0.28}
                  maxZoom={1.35}
                  nodesDraggable
                  nodesConnectable={false}
                  elementsSelectable
                  onNodesChange={handleMindNodesChange}
                  onNodeClick={(_, node) => setSelectedId(node.id)}
                  onNodeDragStop={(_, node) => keepMindNodePosition(node)}
                  onPaneClick={() => setMindContextMenu(null)}
                  onPaneContextMenu={openMindContextMenu}
                >
                  <Background color="rgba(123,248,156,.18)" gap={22} />
                  <Controls showInteractive={false} />
                </ReactFlow>
                {mindContextMenu ? (
                  <div className="mind-context-menu" style={{ left: mindContextMenu.x, top: mindContextMenu.y }}>
                    <button type="button" onClick={formatMindLayout}>{isEnglish ? "Format layout" : "一键格式化"}</button>
                  </div>
                ) : null}
              </div>
            </section>

            <aside className="task-map-tree-panel mind-editor-panel">
              <div className="task-panel-title">
                <span>{isEnglish ? "Selected Node" : "当前节点"}</span>
                <button type="button" onClick={() => addChild()}>{isEnglish ? "Add" : "新增"}</button>
              </div>
              <TaskTree
                rows={visibleTasks}
                selectedId={selected.id}
                childrenByParent={childrenByParent}
                onSelect={setSelectedId}
                onToggle={(task) => updateTask(task.id, { collapsed: !task.collapsed })}
              />
              <TaskEditor
                isEnglish={isEnglish}
                actionMode="breakdown"
                selected={selected}
                root={root}
                isBusy={isBusy}
                hasChildren={Boolean((childrenByParent.get(selected.id) ?? []).length)}
                onUpdate={updateTask}
                onAiBreakdown={() => void createAiBreakdown()}
                onSchedule={scheduleChildren}
                onDelete={removeTask}
              />
            </aside>
          </section>
        ) : (
          <section className="task-map-workbench">
            <aside className="task-map-tree-panel">
              <div className="task-panel-title">
                <span>{isEnglish ? "Task Tree" : "任务树"}</span>
                <button type="button" onClick={() => addChild()}>{isEnglish ? "Add" : "新增"}</button>
              </div>
              <TaskTree
                rows={visibleTasks}
                selectedId={selected.id}
                childrenByParent={childrenByParent}
                onSelect={setSelectedId}
                onToggle={(task) => updateTask(task.id, { collapsed: !task.collapsed })}
              />
              <TaskEditor
                isEnglish={isEnglish}
                actionMode="schedule"
                selected={selected}
                root={root}
                isBusy={isBusy}
                hasChildren={Boolean((childrenByParent.get(selected.id) ?? []).length)}
                onUpdate={updateTask}
                onAiBreakdown={() => void createAiBreakdown()}
                onSchedule={scheduleChildren}
                onDelete={removeTask}
              />
            </aside>

            <section className="task-map-gantt-panel">
              <div className="task-panel-title">
                <span>{isEnglish ? "Timeline / Gantt" : "时间轴 / 甘特图"}</span>
                <div className="task-map-range">
                  <button type="button" onClick={() => { setViewStart(0); setViewLength(Math.max(60, totalEnd + 8)); }}>{isEnglish ? "Fit all" : "显示全部"}</button>
                  <button type="button" onClick={resetProject}>{isEnglish ? "Reset" : "恢复示例"}</button>
                </div>
              </div>

              <div className="task-overview">
                <label>
                  {isEnglish ? "Window" : "视图窗口"}
                  <input type="range" min={0} max={Math.max(0, totalEnd - viewLength + 8)} value={viewStart} onChange={(event) => setViewStart(Number(event.target.value))} />
                </label>
                <label>
                  {isEnglish ? "Zoom" : "缩放"}
                  <input type="range" min={24} max={Math.max(60, totalEnd + 8)} value={viewLength} onChange={(event) => setViewLength(Number(event.target.value))} />
                </label>
              </div>

              <div className="task-gantt-scroll" ref={chartRef} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                <div className="task-gantt-grid" style={{ width: timelineDays.length * dayWidth + 260 }}>
                  <div className="task-gantt-dates">
                    <span />
                    {timelineDays.map((day) => <b key={day}>{day % 7 === 0 ? formatDay(day) : ""}</b>)}
                  </div>
                  {visibleTasks.map((task) => {
                    const left = 260 + (task.startDay - viewStart) * dayWidth;
                    const width = Math.max(18, (task.endDay - task.startDay + 1) * dayWidth);
                    const clipped = task.endDay < viewStart || task.startDay > viewStart + viewLength;
                    return (
                      <div className={`task-gantt-row${task.id === selected.id ? " selected" : ""}`} key={task.id} style={{ minWidth: timelineDays.length * dayWidth + 260 }}>
                        <button className="task-gantt-label" type="button" style={{ paddingLeft: 12 + task.depth * 16 }} onClick={() => setSelectedId(task.id)}>
                          <span>{task.title}</span>
                          <small>{formatDay(task.startDay)} - {formatDay(task.endDay)}</small>
                        </button>
                        <div className="task-gantt-track">
                          {task.dependsOn?.map((dependencyId) => <span className="task-dependency-dot" key={dependencyId} title={dependencyId} />)}
                          {!clipped ? (
                            <div
                              className={`task-bar depth-${Math.min(task.depth, 3)}`}
                              style={{ left, width, top: 8 + task.lane * 3 }}
                              onPointerDown={(event) => beginDrag(event, task, "move")}
                            >
                              <i className="task-bar-handle start" onPointerDown={(event) => beginDrag(event, task, "start")} />
                              <span>{task.title}</span>
                              <i className="task-bar-handle end" onPointerDown={(event) => beginDrag(event, task, "end")} />
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </section>
        )}
      </main>
    </div>
  );
}

function TaskEditor({ isEnglish, actionMode, selected, root, isBusy, hasChildren, onUpdate, onAiBreakdown, onSchedule, onDelete }: {
  isEnglish: boolean;
  actionMode: TaskPhase extends infer _ ? "breakdown" | "schedule" : never;
  selected: TaskNode;
  root: TaskNode;
  isBusy: boolean;
  hasChildren: boolean;
  onUpdate: (id: string, patch: Partial<TaskNode>) => void;
  onAiBreakdown: () => void;
  onSchedule: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="task-editor">
      <label>
        {isEnglish ? "Title" : "标题"}
        <input value={selected.title} onChange={(event) => onUpdate(selected.id, { title: event.target.value })} />
      </label>
      <label>
        {isEnglish ? "Note" : "备注"}
        <textarea value={selected.note ?? ""} onChange={(event) => onUpdate(selected.id, { note: event.target.value })} />
      </label>
      <div className="task-editor-actions">
        {actionMode === "breakdown" ? (
          <button type="button" onClick={onAiBreakdown} disabled={isBusy || hasChildren}>{isEnglish ? "AI split" : "AI 拆解"}</button>
        ) : (
          <button type="button" onClick={onSchedule} disabled={isBusy || !hasChildren}>{isEnglish ? "AI schedule" : "AI 时间初排"}</button>
        )}
        <button type="button" onClick={() => onDelete(selected.id)} disabled={selected.id === root.id}>{isEnglish ? "Delete" : "删除"}</button>
      </div>
    </div>
  );
}

function TaskTree({ rows, selectedId, childrenByParent, onSelect, onToggle }: {
  rows: Array<TaskNode & { depth: number }>;
  selectedId: string;
  childrenByParent: Map<string, TaskNode[]>;
  onSelect: (id: string) => void;
  onToggle: (task: TaskNode) => void;
}) {
  return (
    <div className="task-tree">
      {rows.map((task) => {
        const hasChildren = Boolean((childrenByParent.get(task.id) ?? []).length);
        return (
          <div className={`task-tree-row${task.id === selectedId ? " selected" : ""}`} key={task.id} style={{ paddingLeft: 8 + task.depth * 18 }}>
            <button className="task-tree-toggle" type="button" onClick={() => hasChildren ? onToggle(task) : onSelect(task.id)}>
              {hasChildren ? (task.collapsed ? "+" : "-") : "•"}
            </button>
            <button className="task-tree-title" type="button" onClick={() => onSelect(task.id)}>
              <span>{task.title}</span>
              {task.note ? <small>{task.note}</small> : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}
