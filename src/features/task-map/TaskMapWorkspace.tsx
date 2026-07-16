import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Background, Controls, Handle, Position, ReactFlow, SelectionMode, applyNodeChanges, type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createTaskBreakdown, createTaskSchedule, type TaskMapBreakdownItem, type TaskMapScheduleItem } from "../../lib/core-api";
import { createTaskMapProjectDocument, parseTaskMapProjectDocument, projectStateSnapshot, type TaskMapPhase as TaskPhase, type TaskMapProjectState, type TaskMapTask as TaskNode } from "./project-file";
import "./task-map.css";

type Language = "zh" | "en";

type DragState = {
  id: string;
  mode: "move" | "start" | "end";
  startX: number;
  startY: number;
  originalStart: number;
  originalEnd: number;
  originalLane: number;
  activated: boolean;
  changed: boolean;
};

type FullscreenPanel = TaskPhase | null;

type MindNodeData = {
  task: TaskNode;
  depth: number;
  hasChildren: boolean;
  selected: boolean;
  busy: boolean;
  root: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onRenameComplete: (id: string) => void;
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

type TimelinePopoverState = {
  taskId: string;
  x: number;
  y: number;
} | null;

const storageKey = "muyang-task-map-project-v1";
const minVisibleDays = 2;
const minDuration = 2;
const ganttRowHeight = 48;
const dragActivateDistance = 6;
const branchHuePalette = [188, 172, 148, 112, 82, 58];

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

function todayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function dateFromDay(day: number) {
  const date = todayStart();
  date.setDate(date.getDate() + Math.round(day));
  return date;
}

function formatDay(day: number) {
  const date = dateFromDay(day);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  const currentYear = todayStart().getFullYear();
  const year = date.getFullYear();
  return year === currentYear ? `${month}.${dayOfMonth}` : `${year}.${month}.${dayOfMonth}`;
}

function formatTimelineTick(day: number, visibleDays: number) {
  const date = dateFromDay(day);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  const currentYear = todayStart().getFullYear();
  if (visibleDays >= 900) return String(year);
  if (visibleDays >= 120) return year === currentYear ? `${month}月` : `${year}.${month}`;
  return year === currentYear ? `${month}.${dayOfMonth}` : `${year}.${month}.${dayOfMonth}`;
}

function shouldShowTimelineTick(day: number, index: number, visibleDays: number) {
  const date = dateFromDay(day);
  if (index === 0) return true;
  if (visibleDays >= 900) return date.getMonth() === 0 && date.getDate() === 1;
  if (visibleDays >= 120) return date.getDate() === 1;
  if (visibleDays >= 60) return index % 14 === 0;
  if (visibleDays >= 35) return index % 7 === 0;
  if (visibleDays >= 15) return index % 3 === 0;
  return true;
}

function normalizeDateInput(value: string) {
  return value
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, ".")
    .replace(/[／]/g, "/")
    .replace(/[，、]/g, ",")
    .replace(/[年月]/g, ".")
    .replace(/[日号]/g, "");
}

function parseTimelineDateInput(value: string) {
  const parts = normalizeDateInput(value).trim().match(/\d+/g);
  if (!parts?.length) return null;
  const currentYear = todayStart().getFullYear();
  let year = currentYear;
  let month: number;
  let dayOfMonth: number;

  if (parts.length >= 3) {
    const first = parts[0];
    if (first.length === 4 || Number(first) > 31) {
      year = Number(first);
      month = Number(parts[1]);
      dayOfMonth = Number(parts[2]);
    } else if (first.length === 2 && Number(first) > 12) {
      year = 2000 + Number(first);
      month = Number(parts[1]);
      dayOfMonth = Number(parts[2]);
    } else {
      month = Number(parts[0]);
      dayOfMonth = Number(parts[1]);
    }
  } else if (parts.length === 2) {
    month = Number(parts[0]);
    dayOfMonth = Number(parts[1]);
  } else {
    const compact = parts[0];
    if (compact.length === 3 || compact.length === 4) {
      month = Number(compact.slice(0, compact.length - 2));
      dayOfMonth = Number(compact.slice(-2));
    } else {
      return null;
    }
  }

  const date = new Date(year, month - 1, dayOfMonth);
  date.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== dayOfMonth) return null;
  return Math.round((date.getTime() - todayStart().getTime()) / 86_400_000);
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

const MIND_ROW_GAP = 112;
const MIND_COLUMN_GAP = 420;

function createTreeMindLayout(rows: Array<TaskNode & { depth: number }>) {
  const positions: Record<string, { x: number; y: number }> = {};
  const visibleIds = new Set(rows.map((task) => task.id));
  const childrenByParent = new Map<string, Array<TaskNode & { depth: number }>>();
  rows.forEach((task) => {
    if (!task.parentId || !visibleIds.has(task.parentId)) return;
    const children = childrenByParent.get(task.parentId) ?? [];
    children.push(task);
    childrenByParent.set(task.parentId, children);
  });
  let leafIndex = 0;
  const placeSubtree = (task: TaskNode & { depth: number }): number => {
    const children = childrenByParent.get(task.id) ?? [];
    const childYPositions = children.map(placeSubtree);
    const y = childYPositions.length
      ? (childYPositions[0] + childYPositions[childYPositions.length - 1]) / 2
      : leafIndex++ * MIND_ROW_GAP;
    positions[task.id] = {
      x: task.depth * MIND_COLUMN_GAP,
      y,
    };
    return y;
  };
  if (rows[0]) placeSubtree(rows[0]);
  return positions;
}

function directChildren(parentId: string, tasks: TaskNode[]) {
  return tasks.filter((task) => task.parentId === parentId);
}

function includeAncestorRanges(tasks: TaskNode[]) {
  let nextTasks = tasks;
  let changed = true;
  while (changed) {
    changed = false;
    nextTasks = nextTasks.map((task) => {
      const children = nextTasks.filter((child) => child.parentId === task.id);
      if (!children.length) return task;
      const startDay = Math.min(task.startDay, ...children.map((child) => child.startDay));
      const endDay = Math.max(task.endDay, ...children.map((child) => child.endDay));
      if (startDay === task.startDay && endDay === task.endDay) return task;
      changed = true;
      return { ...task, startDay, endDay };
    });
  }
  return nextTasks;
}

function applySequentialLaneDependencies(tasks: TaskNode[], parentId: string | undefined, lane: number) {
  const siblings = tasks
    .filter((task) => task.parentId === parentId && task.lane === lane)
    .sort((a, b) => a.startDay - b.startDay || a.endDay - b.endDay);
  const siblingIds = new Set(siblings.map((task) => task.id));
  return tasks.map((task) => {
    const index = siblings.findIndex((sibling) => sibling.id === task.id);
    if (index < 0) return task;
    const externalDependencies = task.dependsOn?.filter((id) => !siblingIds.has(id)) ?? [];
    const previous = siblings[index - 1];
    const duration = Math.max(minDuration, task.endDay - task.startDay);
    const startDay = previous ? Math.max(task.startDay, previous.endDay + 1) : task.startDay;
    const endDay = startDay === task.startDay ? task.endDay : startDay + duration;
    return {
      ...task,
      startDay,
      endDay,
      dependsOn: previous ? [...externalDependencies, previous.id] : externalDependencies.length ? externalDependencies : undefined,
    };
  });
}

function compactSiblingLanes(tasks: TaskNode[], parentId: string | undefined) {
  const siblings = tasks.filter((task) => task.parentId === parentId);
  const lanes = [...new Set(siblings.map((task) => task.lane))].sort((a, b) => a - b);
  const laneMap = new Map(lanes.map((lane, index) => [lane, index]));
  return tasks.map((task) => {
    if (task.parentId !== parentId) return task;
    const lane = laneMap.get(task.lane) ?? task.lane;
    return lane === task.lane ? task : { ...task, lane };
  });
}

function normalizeTimelineTasks(tasks: TaskNode[]) {
  const parentIds = new Set(tasks.map((task) => task.parentId));
  let nextTasks = tasks;
  parentIds.forEach((parentId) => {
    nextTasks = compactSiblingLanes(nextTasks, parentId);
  });
  const laneKeys = new Set(nextTasks.map((task) => `${task.parentId ?? "__root__"}:${task.lane}`));
  laneKeys.forEach((key) => {
    const [parentKey, laneValue] = key.split(":");
    nextTasks = applySequentialLaneDependencies(nextTasks, parentKey === "__root__" ? undefined : parentKey, Number(laneValue));
  });
  return includeAncestorRanges(nextTasks);
}

function firstLevelBranch(task: TaskNode, root: TaskNode, tasks: TaskNode[]) {
  if (task.id === root.id) return root;
  let cursor = task;
  while (cursor.parentId && cursor.parentId !== root.id) {
    const parent = tasks.find((item) => item.id === cursor.parentId);
    if (!parent) break;
    cursor = parent;
  }
  return cursor.parentId === root.id ? cursor : task;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
        <input
          className="mind-node-title-input nodrag"
          value={data.task.title}
          aria-label="Task title"
          onFocus={(event) => {
            data.onSelect(data.task.id);
            event.currentTarget.select();
          }}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => data.onRename(data.task.id, event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
              data.onRenameComplete(data.task.id);
            }
          }}
        />
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

export function TaskMapWorkspace({ desktopMode = false, language, onLanguageChange, onOpenHome }: { desktopMode?: boolean; language: Language; onLanguageChange: (language: Language) => void; onOpenHome: () => void }) {
  const isEnglish = language === "en";
  const [tasks, setTasks] = useState<TaskNode[]>(loadInitialTasks);
  const [selectedId, setSelectedId] = useState("goal");
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(["goal"]);
  const [phase, setPhase] = useState<TaskPhase>("structure");
  const [mindFlowNodes, setMindFlowNodes] = useState<Node<MindNodeData>[]>([]);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [mindContextMenu, setMindContextMenu] = useState<ContextMenuState>(null);
  const [viewStart, setViewStart] = useState(0);
  const [viewLength, setViewLength] = useState(60);
  const [chartWidth, setChartWidth] = useState(1440);
  const [message, setMessage] = useState(isEnglish ? "Ready." : "已就绪。");
  const [isBusy, setIsBusy] = useState(false);
  const [timelinePopover, setTimelinePopover] = useState<TimelinePopoverState>(null);
  const [rootStartInput, setRootStartInput] = useState("");
  const [rootEndInput, setRootEndInput] = useState("");
  const [fullscreenPanel, setFullscreenPanel] = useState<FullscreenPanel>(null);
  const [projectPath, setProjectPath] = useState<string>();
  const [projectCreatedAt, setProjectCreatedAt] = useState(() => new Date().toISOString());
  const [savedProjectState, setSavedProjectState] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const mindPanelRef = useRef<HTMLElement | null>(null);
  const mindCanvasRef = useRef<HTMLDivElement | null>(null);
  const mindFlowRef = useRef<ReactFlowInstance<Node<MindNodeData>, Edge> | null>(null);
  const ganttPanelRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragHoldTimerRef = useRef<number | null>(null);
  const latestTasksRef = useRef<TaskNode[]>(tasks);

  const readFullscreenPanel = useCallback((): FullscreenPanel => {
    const element = document.fullscreenElement;
    if (element === mindPanelRef.current) return "structure";
    if (element === ganttPanelRef.current) return "timeline";
    return null;
  }, []);

  const root = tasks.find((task) => !task.parentId) ?? tasks[0];
  const selected = tasks.find((task) => task.id === selectedId) ?? root;
  latestTasksRef.current = tasks;
  const currentProjectState = useMemo<TaskMapProjectState>(() => ({
    tasks,
    nodePositions,
    view: { phase, selectedId, viewStart, viewLength },
  }), [nodePositions, phase, selectedId, tasks, viewLength, viewStart]);
  const currentProjectSnapshot = useMemo(() => projectStateSnapshot(currentProjectState), [currentProjectState]);
  const projectDirty = desktopMode && savedProjectState !== null && savedProjectState !== currentProjectSnapshot;
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
  const ganttLaneHostByTaskId = useMemo(() => {
    const groups = new Map<string, Array<TaskNode & { depth: number }>>();
    visibleTasks.forEach((task) => {
      const key = `${task.parentId ?? "root"}:${task.lane}`;
      const list = groups.get(key) ?? [];
      list.push(task);
      groups.set(key, list);
    });
    const hosts = new Map<string, string>();
    groups.forEach((group) => {
      const host = group[0];
      group.forEach((task) => hosts.set(task.id, host.id));
    });
    return hosts;
  }, [visibleTasks]);
  const ganttRows = useMemo(
    () => visibleTasks.filter((task) => ganttLaneHostByTaskId.get(task.id) === task.id),
    [ganttLaneHostByTaskId, visibleTasks],
  );

  const totalStart = Math.min(...tasks.map((task) => task.startDay), 0);
  const totalEnd = Math.max(...tasks.map((task) => task.endDay), 120);
  const totalDays = totalEnd - totalStart + 1;
  const maxVisibleDays = Math.max(minVisibleDays, totalDays);
  const trackViewportWidth = Math.max(360, chartWidth);
  const visibleDayCount = clamp(Math.round(viewLength), minVisibleDays, maxVisibleDays);
  const viewEnd = viewStart + visibleDayCount - 1;
  const timelineDayWidth = trackViewportWidth / Math.max(1, visibleDayCount);
  const timelineDays = Array.from({ length: visibleDayCount }, (_, index) => viewStart + index);
  const taskBarColor = (task: TaskNode & { depth: number }) => {
    const depth = Math.max(0, task.depth);
    const rootChildren = directChildren(root.id, tasks);
    const branch = firstLevelBranch(task, root, tasks);
    const branchIndex = Math.max(0, rootChildren.findIndex((child) => child.id === branch.id));
    const baseHue = task.id === root.id ? 148 : branchHuePalette[branchIndex % branchHuePalette.length];
    const hue = clamp(baseHue - Math.max(0, depth - 1) * 2, 48, 196);
    const saturation = clamp(92 - Math.max(0, depth - 1) * 7, 52, 92);
    const lightness = clamp(62 + Math.max(0, depth - 1) * 8, 62, 86);
    const alpha = clamp(1 - Math.max(0, depth - 1) * 0.08, 0.62, 1);
    return {
      bg: `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`,
      border: `hsla(${hue}, ${Math.max(50, saturation - 12)}%, ${Math.max(48, lightness - 8)}%, .58)`,
      shadow: `hsla(${hue}, ${saturation}%, ${lightness}%, .2)`,
    };
  };

  const taskBarStyle = (task: TaskNode & { depth: number }, left: number, width: number): CSSProperties => {
    const color = taskBarColor(task);
    return {
      left,
      width,
      top: 8 + task.lane * 3,
      "--task-bar-bg": color.bg,
      "--task-bar-border": color.border,
      "--task-bar-shadow": color.shadow,
    } as CSSProperties;
  };

  useEffect(() => {
    const node = chartRef.current;
    if (!node) return;
    const updateWidth = () => setChartWidth(node.clientWidth || 1440);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [phase]);

  useEffect(() => {
    const syncFullscreenState = () => setFullscreenPanel(readFullscreenPanel());
    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    window.addEventListener("focus", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      window.removeEventListener("focus", syncFullscreenState);
    };
  }, [readFullscreenPanel]);

  useEffect(() => {
    setFullscreenPanel(readFullscreenPanel());
  }, [phase, readFullscreenPanel]);

  const toggleFullscreen = async (panel: TaskPhase) => {
    const target = panel === "structure" ? mindPanelRef.current : ganttPanelRef.current;
    if (!target?.requestFullscreen) {
      setMessage(isEnglish ? "This browser does not support fullscreen mode." : "当前浏览器不支持全屏模式。");
      return;
    }
    try {
      if (document.fullscreenElement === target) {
        setFullscreenPanel(null);
        await document.exitFullscreen();
      } else {
        if (document.fullscreenElement) await document.exitFullscreen();
        await target.requestFullscreen();
        setFullscreenPanel(panel);
      }
      window.requestAnimationFrame(() => setFullscreenPanel(readFullscreenPanel()));
    } catch {
      setMessage(isEnglish ? "Fullscreen mode was blocked by the browser." : "浏览器拦截了全屏操作。");
    }
  };

  useEffect(() => {
    const nextLength = clamp(Math.round(viewLength), minVisibleDays, maxVisibleDays);
    const maxStart = Math.max(totalStart, totalEnd - nextLength + 1);
    if (viewLength !== nextLength) setViewLength(nextLength);
    if (viewStart < totalStart) setViewStart(totalStart);
    else if (viewStart > maxStart) setViewStart(maxStart);
  }, [maxVisibleDays, totalEnd, totalStart, viewLength, viewStart]);

  useEffect(() => {
    setRootStartInput(formatDay(root.startDay));
  }, [root.id, root.startDay]);

  useEffect(() => {
    setRootEndInput(formatDay(root.endDay));
  }, [root.id, root.endDay]);

  const persist = (nextTasks: TaskNode[]) => {
    const normalizedTasks = includeAncestorRanges(nextTasks);
    setTasks(normalizedTasks);
    window.localStorage.setItem(storageKey, JSON.stringify(normalizedTasks));
  };

  const applyDesktopProject = useCallback((result: TaskMapDesktopFileResult) => {
    if (result.canceled || !result.content) return;
    try {
      const project = parseTaskMapProjectDocument(result.content);
      const state: TaskMapProjectState = {
        tasks: project.tasks,
        nodePositions: project.nodePositions,
        view: project.view,
      };
      setTasks(project.tasks);
      setNodePositions(project.nodePositions);
      setSelectedId(project.view.selectedId);
      setSelectedNodeIds([project.view.selectedId]);
      setPhase(project.view.phase);
      setViewStart(project.view.viewStart);
      setViewLength(project.view.viewLength);
      setProjectPath(result.path);
      setProjectCreatedAt(project.createdAt);
      setSavedProjectState(projectStateSnapshot(state));
      window.localStorage.setItem(storageKey, JSON.stringify(project.tasks));
      setMessage(isEnglish ? "Project opened." : "项目已打开。");
      window.requestAnimationFrame(() => mindFlowRef.current?.fitView({ padding: 0.18, duration: 420 }));
    } catch {
      setMessage(isEnglish ? "This .my project is invalid or unsupported." : "这个 .my 项目无效或版本不受支持。");
    }
  }, [isEnglish]);

  const saveDesktopProject = useCallback(async () => {
    if (!window.taskMapDesktop) return false;
    const document = createTaskMapProjectDocument(currentProjectState, projectCreatedAt);
    const rootTask = document.tasks.find((task) => !task.parentId);
    const safeTitle = (rootTask?.title || (isEnglish ? "Untitled plan" : "未命名计划")).replace(/[\\/:*?"<>|]/g, "-");
    const result = await window.taskMapDesktop.saveProject({
      path: projectPath,
      content: JSON.stringify(document, null, 2),
      suggestedName: `${safeTitle}.my`,
    });
    if (result.canceled) return false;
    setProjectPath(result.path);
    setSavedProjectState(currentProjectSnapshot);
    setMessage(isEnglish ? "Project saved." : "项目已保存。");
    return true;
  }, [currentProjectSnapshot, currentProjectState, isEnglish, projectCreatedAt, projectPath]);

  const openDesktopProject = useCallback(async () => {
    if (!window.taskMapDesktop) return;
    if (projectDirty && !window.confirm(isEnglish ? "Discard unsaved changes and open another project?" : "要放弃未保存的更改并打开其他项目吗？")) return;
    applyDesktopProject(await window.taskMapDesktop.openProject());
  }, [applyDesktopProject, isEnglish, projectDirty]);

  const newDesktopProject = useCallback(() => {
    if (projectDirty && !window.confirm(isEnglish ? "Discard unsaved changes and create a new project?" : "要放弃未保存的更改并新建项目吗？")) return;
    const nextTasks: TaskNode[] = [{
      id: createId("goal"),
      title: isEnglish ? "To rename" : "待重命名",
      note: isEnglish ? "Define the single overall goal." : "请先定义唯一的总目标。",
      startDay: 0,
      endDay: 29,
      lane: 0,
    }];
    const nextState: TaskMapProjectState = {
      tasks: nextTasks,
      nodePositions: {},
      view: { phase: "structure", selectedId: nextTasks[0].id, viewStart: 0, viewLength: 30 },
    };
    setTasks(nextTasks);
    setNodePositions({});
    setSelectedId(nextTasks[0].id);
    setSelectedNodeIds([nextTasks[0].id]);
    setPhase("structure");
    setViewStart(0);
    setViewLength(30);
    setProjectPath(undefined);
    setProjectCreatedAt(new Date().toISOString());
    setSavedProjectState("");
    window.localStorage.setItem(storageKey, JSON.stringify(nextTasks));
    setMessage(isEnglish ? "New project created. Rename the root goal." : "新项目已建立，请先重命名总目标。");
  }, [isEnglish, projectDirty]);

  useEffect(() => {
    if (!desktopMode || !window.taskMapDesktop) return;
    if (savedProjectState === null) setSavedProjectState(currentProjectSnapshot);
    void window.taskMapDesktop.getLaunchProject().then(applyDesktopProject);
    return window.taskMapDesktop.onProjectOpened(applyDesktopProject);
  }, [applyDesktopProject, desktopMode]);

  useEffect(() => {
    if (!desktopMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void saveDesktopProject();
      } else if (key === "o") {
        event.preventDefault();
        void openDesktopProject();
      } else if (key === "n") {
        event.preventDefault();
        newDesktopProject();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [desktopMode, newDesktopProject, openDesktopProject, saveDesktopProject]);

  useEffect(() => {
    if (!desktopMode || !window.taskMapDesktop) return;
    window.taskMapDesktop.setDirtyState(projectDirty);
  }, [desktopMode, projectDirty]);

  const arrangeMindTree = (nextTasks: TaskNode[], focusId?: string) => {
    const nextRoot = nextTasks.find((task) => !task.parentId) ?? nextTasks[0];
    if (!nextRoot) return;
    const nextChildrenByParent = new Map<string, TaskNode[]>();
    nextTasks.forEach((task) => {
      if (!task.parentId) return;
      const children = nextChildrenByParent.get(task.parentId) ?? [];
      children.push(task);
      nextChildrenByParent.set(task.parentId, children);
    });
    const nextVisibleTasks = collectVisibleTaskRows(nextRoot, nextChildrenByParent);
    const nextPositions = createTreeMindLayout(nextVisibleTasks);
    setNodePositions(nextPositions);
    setMindFlowNodes((nodes) => nodes.map((node) => ({
      ...node,
      position: nextPositions[node.id] ?? node.position,
    })));
    window.requestAnimationFrame(() => {
      const focusPosition = focusId ? nextPositions[focusId] : undefined;
      if (focusPosition) {
        void mindFlowRef.current?.setCenter(focusPosition.x + 116, focusPosition.y + 44, { duration: 420, zoom: 0.9 });
      } else {
        void mindFlowRef.current?.fitView({ padding: 0.18, duration: 480 });
      }
    });
  };

  const selectTask = useCallback((id: string) => {
    setSelectedId(id);
    setSelectedNodeIds([id]);
  }, []);

  const finishNodeRename = useCallback((id: string) => {
    selectTask(id);
    window.requestAnimationFrame(() => mindCanvasRef.current?.focus({ preventScroll: true }));
  }, [selectTask]);

  const updateTask = (id: string, patch: Partial<TaskNode>) => {
    persist(tasks.map((task) => task.id === id ? { ...task, ...patch } : task));
  };

  const commitRootDateInput = (kind: "start" | "end") => {
    const rawValue = kind === "start" ? rootStartInput : rootEndInput;
    const parsedDay = parseTimelineDateInput(rawValue);
    if (parsedDay === null) {
      if (kind === "start") setRootStartInput(formatDay(root.startDay));
      else setRootEndInput(formatDay(root.endDay));
      return;
    }
    if (kind === "start") {
      const nextStart = parsedDay;
      const nextEnd = nextStart > root.endDay - minDuration ? nextStart + minDuration : root.endDay;
      updateTask(root.id, { startDay: nextStart, endDay: nextEnd });
      setRootStartInput(formatDay(nextStart));
    } else {
      const nextEnd = parsedDay;
      const nextStart = nextEnd < root.startDay + minDuration ? nextEnd - minDuration : root.startDay;
      updateTask(root.id, { startDay: nextStart, endDay: nextEnd });
      setRootEndInput(formatDay(nextEnd));
    }
  };

  const handleRootDateKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, kind: "start" | "end") => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commitRootDateInput(kind);
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (kind === "start") setRootStartInput(formatDay(root.startDay));
      else setRootEndInput(formatDay(root.endDay));
      event.currentTarget.blur();
    }
  };

  const insertTask = (parent: TaskNode, options?: { title?: string; note?: string; select?: boolean }) => {
    const children = childrenByParent.get(parent.id) ?? [];
    const startDay = clamp(parent.startDay + children.length * 4, parent.startDay, parent.endDay - minDuration);
    const next: TaskNode = {
      id: createId(),
      parentId: parent.id,
      title: options?.title ?? (isEnglish ? "New subtask" : "新的子任务"),
      note: options?.note ?? "",
      startDay,
      endDay: clamp(startDay + 12, startDay + minDuration, parent.endDay),
      lane: children.length,
    };
    const nextTasks = [...tasks.map((task) => task.id === parent.id ? { ...task, collapsed: false } : task), next];
    persist(nextTasks);
    if (options?.select ?? true) selectTask(next.id);
    arrangeMindTree(nextTasks, next.id);
    return next;
  };

  const addChild = (parent = selected) => {
    insertTask(parent);
  };

  const addChildById = useCallback((parentId: string) => {
    const parent = tasks.find((task) => task.id === parentId);
    if (parent) addChild(parent);
  }, [tasks, childrenByParent, isEnglish, selected, visibleTasks]);

  const removeTasks = useCallback((idsToRemove: string[]) => {
    const initialIds = [...new Set(idsToRemove)].filter((id) => id !== root.id);
    if (!initialIds.length) {
      setMessage(isEnglish ? "The root goal cannot be deleted." : "总目标不能删除。");
      return;
    }
    const ids = new Set<string>(initialIds);
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
    selectTask(root.id);
    setNodePositions((positions) => Object.fromEntries(Object.entries(positions).filter(([id]) => !ids.has(id))));
    setMessage(isEnglish ? `Deleted ${ids.size} task nodes.` : `已删除 ${ids.size} 个任务节点。`);
  }, [isEnglish, root.id, selectTask, tasks]);

  const removeTask = (id: string) => {
    removeTasks([id]);
  };

  const initializeRootTask = () => {
    const rootOnly: TaskNode[] = [{
      ...root,
      title: isEnglish ? "To rename" : "待重命名",
      parentId: undefined,
      collapsed: false,
      dependsOn: undefined,
    }];
    persist(rootOnly);
    setSelectedNodeIds([root.id]);
    setNodePositions((positions) => root.id in positions ? { [root.id]: positions[root.id] } : {});
    setMessage(isEnglish ? "Root goal initialized. Rename it directly on the node." : "已初始化总任务，请直接点击节点标题重命名。");
  };

  const resetProject = () => {
    persist(seedTasks);
    selectTask("goal");
    setViewStart(0);
    setViewLength(60);
    setMessage(isEnglish ? "Sample project restored." : "已恢复考研示例项目。");
  };

  const createAiBreakdown = async (target = selected) => {
    if (!target) return;
    selectTask(target.id);
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
    const nextTasks = [...tasks.map((task) => task.id === parent.id ? { ...task, collapsed: false } : task), ...children];
    persist(nextTasks);
    arrangeMindTree(nextTasks, children[0]?.id);
    setMessage(isEnglish ? `Inserted ${children.length} subtasks via ${provider}.` : `已通过 ${provider} 插入 ${children.length} 个子任务。`);
  };

  const scheduleChildren = async (target = selected) => {
    const children = childrenByParent.get(target.id) ?? [];
    if (!children.length) {
      setMessage(isEnglish ? "Select a task with children first." : "请先选择一个已有子任务的节点。");
      return;
    }
    selectTask(target.id);
    setIsBusy(true);
    try {
      const result = await createTaskSchedule({
        parent: { ...taskInput(target), startDay: target.startDay, endDay: target.endDay },
        // AI initial scheduling is a fresh semantic plan. Existing dates and
        // lanes stay out of the prompt until explicit task locking exists.
        children: children.map(taskInput),
        locale: language,
      });
      applySchedule(result.items.length ? result.items : distributeSchedule(target, children), result.provider, target);
    } catch {
      applySchedule(distributeSchedule(target, children), "local-fallback", target);
      setMessage(isEnglish ? "Core unavailable, local schedule applied." : "Core 暂不可用，已应用本地时间初排。");
    } finally {
      setIsBusy(false);
    }
  };

  const applySchedule = (items: TaskMapScheduleItem[], provider: string, parent = selected) => {
    const byId = new Map(items.map((item) => [item.id, item]));
    let changedCount = 0;
    const nextTasks = tasks.map((task) => {
      const item = byId.get(task.id);
      if (!item) return task;
      const nextTask = {
        ...task,
        startDay: clamp(Math.round(item.startDay), parent.startDay, parent.endDay - minDuration),
        endDay: clamp(Math.round(item.endDay), Math.round(item.startDay) + minDuration, parent.endDay),
        lane: Math.max(0, Math.round(item.lane)),
        dependsOn: item.dependsOn?.filter((id) => id !== task.id),
        note: item.note || task.note,
      };
      if (nextTask.startDay !== task.startDay || nextTask.endDay !== task.endDay || nextTask.lane !== task.lane || JSON.stringify(nextTask.dependsOn ?? []) !== JSON.stringify(task.dependsOn ?? [])) changedCount += 1;
      return nextTask;
    });
    persist(nextTasks);
    setMessage(isEnglish
      ? `Schedule updated via ${provider}: ${changedCount} of ${byId.size} subtasks changed.`
      : `已通过 ${provider} 初排时间：${byId.size} 个子任务中有 ${changedCount} 个发生变化。`);
  };

  const openTimelinePopover = (event: React.MouseEvent | React.KeyboardEvent, task: TaskNode) => {
    event.stopPropagation();
    selectTask(task.id);
    const point = "clientX" in event ? { x: event.clientX, y: event.clientY } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    setTimelinePopover({
      taskId: task.id,
      x: clamp(point.x, 190, window.innerWidth - 190),
      y: clamp(point.y, 190, window.innerHeight - 32),
    });
  };

  const beginDrag = (event: React.PointerEvent, task: TaskNode, mode: DragState["mode"]) => {
    if (mode !== "move") event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    if (dragHoldTimerRef.current) window.clearTimeout(dragHoldTimerRef.current);
    dragRef.current = { id: task.id, mode, startX: event.clientX, startY: event.clientY, originalStart: task.startDay, originalEnd: task.endDay, originalLane: task.lane, activated: mode !== "move", changed: false };
    if (mode === "move") {
      dragHoldTimerRef.current = window.setTimeout(() => {
        if (dragRef.current?.id === task.id && dragRef.current.mode === "move") {
          dragRef.current = { ...dragRef.current, activated: true, changed: true };
          setMessage(isEnglish ? "Drag mode active. Move left/right or drop onto a sibling row." : "已进入拖动模式，可左右移动或拖到同级任务行。");
        }
      }, 2000);
    }
    setTimelinePopover(null);
  };

  const moveDrag = (event: React.PointerEvent) => {
    let drag = dragRef.current;
    if (!drag) return;
    const movement = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.activated) {
      if (drag.mode !== "move" || movement <= dragActivateDistance) return;
      dragRef.current = { ...drag, activated: true, changed: true };
      drag = dragRef.current;
      setMessage(isEnglish ? "Dragging task. Release on a sibling row to link it." : "正在拖动任务条，松手到同级任务行可生成承接关系。");
    }
    const delta = Math.round((event.clientX - drag.startX) / timelineDayWidth);
    const laneDelta = drag.mode === "move" ? Math.round((event.clientY - drag.startY) / ganttRowHeight) : 0;
    const currentTasks = latestTasksRef.current;
    const task = currentTasks.find((item) => item.id === drag.id);
    if (!task) return;
    const minStart = -36500;
    const maxEnd = Math.max(totalEnd, drag.originalEnd + Math.abs(delta) + 30);
    let startDay = drag.originalStart;
    let endDay = drag.originalEnd;
    let lane = task.lane;
    if (drag.mode === "start") {
      startDay = clamp(drag.originalStart + delta, minStart, drag.originalEnd - minDuration);
    } else if (drag.mode === "end") {
      endDay = clamp(drag.originalEnd + delta, drag.originalStart + minDuration, maxEnd);
    } else {
      const duration = drag.originalEnd - drag.originalStart;
      startDay = clamp(drag.originalStart + delta, minStart, maxEnd - duration);
      endDay = startDay + duration;
      lane = Math.max(0, drag.originalLane + laneDelta);
    }
    const changed = startDay !== task.startDay || endDay !== task.endDay || lane !== task.lane;
    if (changed) dragRef.current = { ...drag, changed: true };
    const nextTasks = includeAncestorRanges(currentTasks.map((item) => item.id === task.id ? { ...item, startDay, endDay, lane } : item));
    latestTasksRef.current = nextTasks;
    setTasks(nextTasks);
  };

  const endDrag = (event?: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag) {
      if (dragHoldTimerRef.current) {
        window.clearTimeout(dragHoldTimerRef.current);
        dragHoldTimerRef.current = null;
      }
      const currentTasks = latestTasksRef.current;
      const task = currentTasks.find((item) => item.id === drag.id);
      let nextTasks = currentTasks;
      if (event && task && drag.mode === "move" && Math.abs(event.clientY - drag.startY) > 18) {
        const dropRowIndex = visibleTasks.findIndex((row) => {
          const rowTop = chartRef.current?.querySelector(`[data-task-row="${row.id}"]`)?.getBoundingClientRect().top ?? Number.NaN;
          return Number.isFinite(rowTop) && event.clientY >= rowTop && event.clientY <= rowTop + ganttRowHeight;
        });
        const target = dropRowIndex >= 0 ? visibleTasks[dropRowIndex] : undefined;
        if (target && target.id !== task.id && target.parentId === task.parentId) {
          nextTasks = applySequentialLaneDependencies(
            nextTasks.map((item) => item.id === task.id ? { ...item, lane: target.lane } : item),
            task.parentId,
            target.lane,
          );
          setMessage(isEnglish ? "Same-level tasks linked in sequence." : "已将同级任务拖入同一轨道，并生成承接关系。");
        }
      }
      const normalizedTasks = normalizeTimelineTasks(nextTasks);
      setTasks(normalizedTasks);
      window.localStorage.setItem(storageKey, JSON.stringify(normalizedTasks));
      const shouldOpenPopover = Boolean(event && task && drag.mode === "move" && !drag.activated && !drag.changed);
      dragRef.current = null;
      if (shouldOpenPopover && task && event) openTimelinePopover(event, task);
    }
  };

  const toggleTaskById = useCallback((taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (task) updateTask(taskId, { collapsed: !task.collapsed });
  }, [tasks]);

  const selectRelativeTask = useCallback((direction: "up" | "down" | "parent" | "child") => {
    const index = visibleTasks.findIndex((task) => task.id === selected.id);
    if (direction === "up" && index > 0) {
      selectTask(visibleTasks[index - 1].id);
      return;
    }
    if (direction === "down" && index >= 0 && index < visibleTasks.length - 1) {
      selectTask(visibleTasks[index + 1].id);
      return;
    }
    if (direction === "parent" && selected.parentId) {
      selectTask(selected.parentId);
      return;
    }
    if (direction === "child") {
      const child = directChildren(selected.id, tasks)[0];
      if (child) selectTask(child.id);
    }
  }, [selectTask, selected, tasks, visibleTasks]);

  const addSiblingAfterSelected = useCallback(() => {
    if (!selected.parentId) {
      setMessage(isEnglish ? "The root goal cannot have siblings." : "总目标不能建立同级任务。");
      return;
    }
    const parent = tasks.find((task) => task.id === selected.parentId);
    if (!parent) return;
    insertTask(parent, { title: isEnglish ? "New sibling task" : "新的同级任务" });
  }, [selected, tasks, isEnglish, visibleTasks, childrenByParent]);

  const deleteSelectedTask = useCallback(() => {
    const ids = selectedNodeIds.length ? selectedNodeIds : [selected.id];
    const removableIds = ids.filter((id) => id !== root.id);
    if (!removableIds.length) {
      setMessage(isEnglish ? "The root goal cannot be deleted." : "总目标不能删除。");
      return;
    }
    const currentIndex = visibleTasks.findIndex((task) => task.id === selected.id);
    removeTasks(removableIds);
    const fallback = visibleTasks[currentIndex - 1] ?? root;
    if (!removableIds.includes(fallback.id)) selectTask(fallback.id);
  }, [isEnglish, removeTasks, root, selectTask, selected.id, selectedNodeIds, visibleTasks]);

  const handleMindMapKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, button")) return;
    if (event.nativeEvent.isComposing) return;

    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectRelativeTask("up");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      selectRelativeTask("down");
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectRelativeTask("parent");
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      selectRelativeTask("child");
    } else if (event.key === "Enter") {
      event.preventDefault();
      addSiblingAfterSelected();
    } else if (event.key === "Tab") {
      event.preventDefault();
      insertTask(selected, { title: isEnglish ? "New child task" : "新的子任务" });
    } else if ((event.key === "Backspace" || event.key === "Delete") && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      deleteSelectedTask();
    } else if ((event.key === "/" || event.key === "?") && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      setMessage(isEnglish ? "Shortcuts: arrows move selection, Enter creates a sibling, Tab creates a child, Delete removes selected nodes. Drag blank space to box-select." : "快捷键：方向键移动选择，Enter 新建同级，Tab 新建子级，Delete 删除。拖动空白处可框选多个节点。");
    }
  }, [addSiblingAfterSelected, deleteSelectedTask, insertTask, isEnglish, selectRelativeTask, selected]);

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
            selected: selectedNodeIds.includes(task.id),
            busy: isBusy,
            root: task.id === root.id,
            onSelect: selectTask,
            onRename: (id, title) => updateTask(id, { title }),
            onRenameComplete: finishNodeRename,
            onAddChild: addChildById,
            onAiBreakdown: createAiBreakdownById,
            onToggle: toggleTaskById,
          },
          draggable: true,
        };
      });
    });
  }, [visibleTasks, nodePositions, childrenByParent, selectedNodeIds, isBusy, root.id, selectTask, finishNodeRename, addChildById, createAiBreakdownById, toggleTaskById]);

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
      data: { depth: task.depth, active: selectedNodeIds.includes(task.id) },
      className: `mind-edge depth-${Math.min(task.depth, 3)}`,
    })), [visibleTasks, selectedNodeIds]);

  const keepMindNodePosition = useCallback((node: Node) => {
    setNodePositions((positions) => ({
      ...positions,
      [node.id]: node.position,
    }));
  }, []);

  const formatMindLayout = useCallback(() => {
    const nextPositions = createTreeMindLayout(visibleTasks);
    setNodePositions(nextPositions);
    setMindFlowNodes((nodes) => nodes.map((node) => ({
      ...node,
      position: nextPositions[node.id] ?? node.position,
    })));
    setMindContextMenu(null);
    setMessage(isEnglish ? "Mind map formatted around subtree centers." : "思维导图已按子树中心格式化。");
    window.requestAnimationFrame(() => mindFlowRef.current?.fitView({ padding: 0.18, duration: 480 }));
  }, [visibleTasks, isEnglish]);

  const openMindContextMenu = useCallback((event: MouseEvent | React.MouseEvent<Element, MouseEvent>) => {
    event.preventDefault();
    setMindContextMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const handleMindSelectionChange = useCallback(({ nodes }: { nodes: Node<MindNodeData>[] }) => {
    if (!nodes.length) return;
    const ids = nodes.map((node) => node.id);
    setSelectedNodeIds(ids);
    setSelectedId(ids[ids.length - 1] ?? ids[0]);
  }, []);

  const downloadHtml = (filename: string, html: string) => {
    if (desktopMode && window.taskMapDesktop) {
      void window.taskMapDesktop.exportFile({
        content: html,
        suggestedName: filename,
        filters: [{ name: "HTML", extensions: ["html"] }],
      }).then((result) => {
        if (!result.canceled) setMessage(isEnglish ? "HTML exported." : "HTML 已导出。");
      });
      return;
    }
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const printHtmlAsPdf = (html: string) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.inset = "0";
    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.border = "0";
    frame.style.opacity = "0";
    frame.style.pointerEvents = "none";

    const removeFrame = () => window.setTimeout(() => frame.remove(), 300);
    frame.addEventListener("load", () => {
      const printWindow = frame.contentWindow;
      if (!printWindow) {
        frame.remove();
        setMessage(isEnglish ? "Unable to open the PDF print dialog." : "无法打开 PDF 打印窗口，请检查浏览器打印权限。");
        return;
      }
      printWindow.addEventListener("afterprint", removeFrame, { once: true });
      window.setTimeout(() => {
        printWindow.focus();
        printWindow.print();
        window.setTimeout(removeFrame, 60_000);
      }, 180);
    }, { once: true });
    frame.srcdoc = html;
    document.body.appendChild(frame);
  };

  const renderTodoItems = (task: TaskNode, depth = 0): string => {
    const children = childrenByParent.get(task.id) ?? [];
    return `
      <li style="--depth:${depth}">
        <div class="todo-line">
          <span class="box"></span>
          <div>
            <strong>${escapeHtml(task.title)}</strong>
            <small>${formatDay(task.startDay)} - ${formatDay(task.endDay)}</small>
            ${task.note ? `<p>${escapeHtml(task.note)}</p>` : ""}
          </div>
        </div>
        ${children.length ? `<ol>${children.map((child) => renderTodoItems(child, depth + 1)).join("")}</ol>` : ""}
      </li>`;
  };

  const exportTodoPdf = () => {
    const html = `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(root.title)} - Todo PDF</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;padding:32px;color:#101418;background:#fff;font-family:Inter,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC",Arial,sans-serif}
    header{margin-bottom:28px;padding-bottom:18px;border-bottom:2px solid #101418}
    p.eyebrow{margin:0 0 8px;color:#16a05c;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em}
    h1{margin:0;font-size:28px;line-height:1.2}
    ol{margin:0;padding-left:0;list-style:none}
    li{break-inside:avoid;margin:0 0 8px}
    li ol{margin-top:8px;margin-left:26px;padding-left:18px;border-left:1px solid #d8e2dc}
    .todo-line{display:grid;grid-template-columns:18px 1fr;gap:10px;align-items:start;padding:9px 0}
    .box{display:block;width:14px;height:14px;margin-top:3px;border:1.5px solid #101418;border-radius:2px}
    strong{font-size:14px;line-height:1.35}
    small{display:block;margin-top:3px;color:#60746a;font:10px ui-monospace,SFMono-Regular,Menlo,monospace}
    .todo-line p{margin:5px 0 0;color:#44564d;font-size:12px;line-height:1.5}
    @page{size:A4;margin:18mm}
    @media print{body{padding:0}.no-print{display:none}}
  </style>
</head>
<body>
  <header>
    <p class="eyebrow">MUYANG TASK MAP / TODO LIST</p>
    <h1>${escapeHtml(root.title)}</h1>
  </header>
  <ol>${renderTodoItems(root)}</ol>
</body>
</html>`;
    if (desktopMode && window.taskMapDesktop) {
      void window.taskMapDesktop.exportPdf({
        html,
        suggestedName: `muyang-task-map-todo-${new Date().toISOString().slice(0, 10)}.pdf`,
      }).then((result) => {
        if (!result.canceled) setMessage(isEnglish ? "PDF exported." : "PDF 已导出。");
      });
      return;
    }
    printHtmlAsPdf(html);
    setMessage(isEnglish ? "Choose Save as PDF in the print dialog." : "请在打印窗口中选择“另存为 PDF”。");
  };

  const renderMindMapNode = (task: TaskNode, depth = 0): string => {
    const children = childrenByParent.get(task.id) ?? [];
    const color = taskBarColor({ ...task, depth });
    return `
      <details class="mind-node depth-${Math.min(depth, 4)}${children.length ? "" : " leaf"}" data-id="${escapeHtml(task.id)}" data-parent="${escapeHtml(task.parentId ?? "")}" ${depth < 2 ? "open" : ""}>
        <summary style="--node-color:${color.bg};--node-shadow:${color.shadow}">
          <span class="knot"></span>
          <span class="copy">
            <strong>${escapeHtml(task.title)}</strong>
            <small>${formatDay(task.startDay)} - ${formatDay(task.endDay)}${task.note ? ` · ${escapeHtml(task.note)}` : ""}</small>
          </span>
        </summary>
        ${children.length ? `<div class="mind-children">${children.map((child) => renderMindMapNode(child, depth + 1)).join("")}</div>` : ""}
      </details>`;
  };

  const exportMindMapHtml = () => {
    const html = `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(root.title)} - Mind Map</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;padding:30px;background:#0b1015;color:#edf4ef;font-family:Inter,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC",Arial,sans-serif}
    header{margin-bottom:24px;padding:18px 20px;border:1px solid #26313a;border-radius:8px;background:linear-gradient(110deg,rgba(123,248,156,.1),transparent 46%),#10171d}
    p{margin:0 0 8px;color:#7bf89c;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em}
    h1{margin:0;font-size:28px;line-height:1.2}
    .map{overflow:auto;padding:28px;border:1px solid #26313a;border-radius:8px;background:radial-gradient(circle at 18% 18%,rgba(123,248,156,.08),transparent 26%),#10171d}
    .mind-node{position:relative;display:inline-flex;align-items:flex-start;gap:34px;margin:0}
    .mind-node>summary{position:relative;display:grid;grid-template-columns:16px minmax(190px,270px);gap:10px;align-items:start;min-height:58px;padding:12px;color:#edf4ef;background:#0d141a;border:1px solid rgba(123,248,156,.28);border-radius:8px;cursor:pointer;list-style:none;box-shadow:0 16px 34px rgba(0,0,0,.22)}
    summary::-webkit-details-marker{display:none}
    .mind-node>summary:hover{border-color:var(--node-color);box-shadow:0 0 24px var(--node-shadow)}
    .knot{width:12px;height:12px;margin-top:4px;border-radius:999px;background:var(--node-color);box-shadow:0 0 18px var(--node-shadow)}
    .copy strong{display:block;font-size:14px;line-height:1.3}
    small{display:block;margin-top:4px;color:#89a195;font-size:11px;line-height:1.4}
    .mind-children{position:relative;display:none;flex-direction:column;gap:16px}
    details[open]>.mind-children{display:flex}
    .mind-children::before{content:"";position:absolute;left:-24px;top:28px;bottom:28px;width:1px;background:linear-gradient(180deg,transparent,rgba(215,255,88,.5),transparent);box-shadow:0 0 12px rgba(215,255,88,.22)}
    .mind-children>.mind-node::before{content:"";position:absolute;left:-24px;top:17px;width:28px;height:28px;border-left:1px solid rgba(215,255,88,.56);border-bottom:1px solid rgba(215,255,88,.62);border-bottom-left-radius:28px;box-shadow:-4px 6px 12px rgba(215,255,88,.12)}
    .leaf>summary{cursor:default}
    .depth-0>summary{background:#14261b;border-color:rgba(123,248,156,.64)}
  </style>
</head>
<body>
  <header>
    <p>MUYANG TASK MAP / READONLY MIND MAP</p>
    <h1>${escapeHtml(root.title)}</h1>
  </header>
  <div class="map">
    ${renderMindMapNode(root)}
  </div>
</body>
</html>`;
    downloadHtml(`muyang-task-map-mindmap-${new Date().toISOString().slice(0, 10)}.html`, html);
  };

  const exportGanttHtml = () => {
    const labelWidth = 280;
    const exportDayWidth = 18;
    const rowHeight = 46;
    const rows = collectVisibleTaskRows(root, childrenByParent);
    const dateLabels = Array.from({ length: totalDays }, (_, index) => ({ day: totalStart + index, index }))
      .filter(({ day, index }) => shouldShowTimelineTick(day, index, totalDays))
      .map(({ day }) => `<span style="left:${labelWidth + (day - totalStart) * exportDayWidth}px">${formatTimelineTick(day, totalDays)}</span>`)
      .join("");
    const rowHtml = rows.map((task, index) => {
      const color = taskBarColor(task);
      const hasChildren = Boolean((childrenByParent.get(task.id) ?? []).length);
      const barLeft = labelWidth + (task.startDay - totalStart) * exportDayWidth;
      const barWidth = Math.max(18, (task.endDay - task.startDay + 1) * exportDayWidth);
      return `
        <div class="gantt-row depth-${Math.min(task.depth, 4)}" data-id="${task.id}" data-parent="${task.parentId ?? ""}" data-depth="${task.depth}" style="top:${72 + index * rowHeight}px">
          <button class="label" type="button" ${hasChildren ? `data-toggle="${task.id}"` : ""} style="padding-left:${12 + task.depth * 18}px">
            <span>${hasChildren ? "▾" : "•"}</span>
            <strong>${escapeHtml(task.title)}</strong>
            <small>${formatDay(task.startDay)} - ${formatDay(task.endDay)}</small>
          </button>
          <div class="bar" title="${escapeHtml(`${task.title} ${formatDay(task.startDay)} - ${formatDay(task.endDay)}`)}" style="left:${barLeft}px;width:${barWidth}px;background:${color.bg};border-color:${color.border};box-shadow:0 0 18px ${color.shadow}">${escapeHtml(task.title)}</div>
        </div>`;
    }).join("");
    const html = `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(root.title)} - Gantt</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;padding:30px;background:#0b1015;color:#edf4ef;font-family:Inter,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC",Arial,sans-serif}
    header{margin-bottom:24px;padding:18px 20px;border:1px solid #26313a;border-radius:8px;background:linear-gradient(110deg,rgba(123,248,156,.1),transparent 46%),#10171d}
    p{margin:0 0 8px;color:#7bf89c;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em}
    h1{margin:0;font-size:28px;line-height:1.2}
    .sheet{position:relative;overflow:auto;min-height:${110 + rows.length * rowHeight}px;border:1px solid #26313a;border-radius:8px;background:#10171d}
    .canvas{position:relative;width:${labelWidth + totalDays * exportDayWidth}px;min-height:${110 + rows.length * rowHeight}px}
    .dates{position:absolute;left:0;right:0;top:0;height:34px;border-bottom:1px solid #26313a;background:#10171d}
    .dates span{position:absolute;top:10px;color:#71877c;font:9px ui-monospace,SFMono-Regular,Menlo,monospace}
    .gantt-row{position:absolute;left:0;width:100%;height:${rowHeight}px;border-bottom:1px solid rgba(38,49,58,.72)}
    .gantt-row.hidden{display:none}
    .label{position:absolute;left:0;top:0;width:${labelWidth}px;height:${rowHeight}px;display:grid;grid-template-columns:18px minmax(0,1fr);align-items:center;column-gap:6px;text-align:left;color:#edf4ef;background:#10171d;border:0;border-right:1px solid #26313a;cursor:pointer}
    .label span{color:#7bf89c;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
    .label strong,.label small{grid-column:2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .label strong{font-size:12px}
    .label small{margin-top:-10px;color:#71877c;font:10px ui-monospace,SFMono-Regular,Menlo,monospace}
    .bar{position:absolute;top:8px;height:30px;padding:7px 10px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#06110d;border:1px solid;border-radius:5px;font-size:11px;font-weight:760}
    .bar::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.18),transparent 46%,rgba(0,0,0,.07));pointer-events:none}
  </style>
</head>
<body>
  <header><p>MUYANG TASK MAP / READONLY GANTT</p><h1>${escapeHtml(root.title)}</h1></header>
  <div class="sheet"><div class="canvas"><div class="dates">${dateLabels}</div>${rowHtml}</div></div>
  <script>
    const rows = Array.from(document.querySelectorAll(".gantt-row"));
    const collapsed = new Set();
    function descendantsOf(id) {
      const result = new Set();
      let changed = true;
      while (changed) {
        changed = false;
        rows.forEach((row) => {
          const parent = row.dataset.parent;
          if (parent && (parent === id || result.has(parent)) && !result.has(row.dataset.id)) {
            result.add(row.dataset.id);
            changed = true;
          }
        });
      }
      return result;
    }
    function update() {
      const hidden = new Set();
      collapsed.forEach((id) => descendantsOf(id).forEach((child) => hidden.add(child)));
      rows.forEach((row) => row.classList.toggle("hidden", hidden.has(row.dataset.id)));
      document.querySelectorAll("[data-toggle]").forEach((button) => {
        const id = button.dataset.toggle;
        const icon = button.querySelector("span");
        if (icon) icon.textContent = collapsed.has(id) ? "▸" : "▾";
      });
    }
    document.querySelectorAll("[data-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.toggle;
        if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
        update();
      });
    });
  </script>
</body>
</html>`;
    downloadHtml(`muyang-task-map-gantt-${new Date().toISOString().slice(0, 10)}.html`, html);
  };

  const exportInteractiveTaskMapHtml = () => {
    const labelWidth = 280;
    const rowHeight = 46;
    const rows = collectVisibleTaskRows(root, childrenByParent);
    const exportStartDay = Math.min(...rows.map((task) => task.startDay), 0);
    const exportEndDay = Math.max(...rows.map((task) => task.endDay), totalEnd);
    const exportSpanDays = Math.max(1, exportEndDay - exportStartDay + 1);
    const toTimelinePercent = (day: number) => ((day - exportStartDay) / exportSpanDays) * 100;
    const toDurationPercent = (startDay: number, endDay: number) => ((endDay - startDay + 1) / exportSpanDays) * 100;
    const dateLabels = Array.from({ length: exportSpanDays }, (_, index) => ({ day: exportStartDay + index, index }))
      .filter(({ day, index }) => shouldShowTimelineTick(day, index, exportSpanDays) || day === exportEndDay)
      .map(({ day }) => `<span style="left:${toTimelinePercent(day)}%">${formatTimelineTick(day, exportSpanDays)}</span>`)
      .join("");
    const rowHtml = rows.map((task, index) => {
      const color = taskBarColor(task);
      const hasChildren = Boolean((childrenByParent.get(task.id) ?? []).length);
      const barLeft = toTimelinePercent(task.startDay);
      const barWidth = Math.max(1.4, toDurationPercent(task.startDay, task.endDay));
      return `
        <div class="gantt-row depth-${Math.min(task.depth, 4)}" data-id="${task.id}" data-parent="${task.parentId ?? ""}" data-depth="${task.depth}" style="top:${72 + index * rowHeight}px">
          <button class="label" type="button" ${hasChildren ? `data-toggle="${task.id}"` : ""} style="padding-left:${12 + task.depth * 18}px">
            <span>${hasChildren ? "▾" : "•"}</span>
            <strong>${escapeHtml(task.title)}</strong>
            <small>${formatDay(task.startDay)} - ${formatDay(task.endDay)}</small>
          </button>
          <div class="timeline">
            <div class="bar" title="${escapeHtml(`${task.title} ${formatDay(task.startDay)} - ${formatDay(task.endDay)}`)}" style="left:${barLeft}%;width:${barWidth}%;background:${color.bg};border-color:${color.border};box-shadow:0 0 18px ${color.shadow}">${escapeHtml(task.title)}</div>
          </div>
        </div>`;
    }).join("");
    const html = `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(root.title)} - Task Map</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;padding:30px;background:#0b1015;color:#edf4ef;font-family:Inter,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC",Arial,sans-serif}
    header{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:20px;padding:18px 20px;border:1px solid #26313a;border-radius:8px;background:linear-gradient(110deg,rgba(123,248,156,.1),transparent 46%),#10171d}
    p{margin:0 0 8px;color:#7bf89c;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em}
    h1{margin:0;font-size:28px;line-height:1.2}
    .tabs{display:inline-flex;overflow:hidden;border:1px solid #26313a;border-radius:8px;background:#0b1015}
    .tabs button{min-width:120px;padding:13px 18px;color:#89a195;background:transparent;border:0;border-right:1px solid #26313a;cursor:pointer;font-weight:800}
    .tabs button:last-child{border-right:0}
    .tabs button.selected{color:#06110d;background:#68f58f}
    .view{display:none}
    .view.active{display:block}
    .map{overflow:auto;padding:28px;border:1px solid #26313a;border-radius:8px;background:radial-gradient(circle at 18% 18%,rgba(123,248,156,.08),transparent 26%),#10171d}
    .mind-node{position:relative;display:inline-flex;align-items:flex-start;gap:34px;margin:0}
    .mind-node>summary{position:relative;display:grid;grid-template-columns:16px minmax(190px,270px);gap:10px;align-items:start;min-height:58px;padding:12px;color:#edf4ef;background:#0d141a;border:1px solid rgba(123,248,156,.28);border-radius:8px;cursor:pointer;list-style:none;box-shadow:0 16px 34px rgba(0,0,0,.22)}
    summary::-webkit-details-marker{display:none}
    .mind-node>summary:hover{border-color:var(--node-color);box-shadow:0 0 24px var(--node-shadow)}
    .knot{width:12px;height:12px;margin-top:4px;border-radius:999px;background:var(--node-color);box-shadow:0 0 18px var(--node-shadow)}
    .copy strong{display:block;font-size:14px;line-height:1.3}
    small{display:block;margin-top:4px;color:#89a195;font-size:11px;line-height:1.4}
    .mind-children{position:relative;display:none;flex-direction:column;gap:16px}
    details[open]>.mind-children{display:flex}
    .mind-children::before{content:"";position:absolute;left:-24px;top:28px;bottom:28px;width:1px;background:linear-gradient(180deg,transparent,rgba(215,255,88,.5),transparent);box-shadow:0 0 12px rgba(215,255,88,.22)}
    .mind-children>.mind-node::before{content:"";position:absolute;left:-24px;top:17px;width:28px;height:28px;border-left:1px solid rgba(215,255,88,.56);border-bottom:1px solid rgba(215,255,88,.62);border-bottom-left-radius:28px;box-shadow:-4px 6px 12px rgba(215,255,88,.12)}
    .leaf>summary{cursor:default}
    .depth-0>summary{background:#14261b;border-color:rgba(123,248,156,.64)}
    .sheet{position:relative;overflow-x:hidden;overflow-y:auto;min-height:${110 + rows.length * rowHeight}px;border:1px solid #26313a;border-radius:8px;background:#10171d}
    .canvas{position:relative;width:100%;min-width:0;min-height:${110 + rows.length * rowHeight}px;transition:min-height .22s ease}
    .dates{position:absolute;left:${labelWidth}px;right:0;top:0;height:34px;border-bottom:1px solid #26313a;background:#10171d}
    .dates span{position:absolute;top:10px;color:#71877c;font:9px ui-monospace,SFMono-Regular,Menlo,monospace}
    .gantt-row{position:absolute;left:0;width:100%;height:${rowHeight}px;border-bottom:1px solid rgba(38,49,58,.72);opacity:1;transform:translateY(0);transition:top .22s ease,opacity .18s ease,transform .22s ease}
    .gantt-row.hidden{opacity:0;pointer-events:none;transform:translateY(-8px)}
    .label{position:absolute;left:0;top:0;width:${labelWidth}px;height:${rowHeight}px;display:grid;grid-template-columns:18px minmax(0,1fr);align-items:center;column-gap:6px;text-align:left;color:#edf4ef;background:#10171d;border:0;border-right:1px solid #26313a;cursor:pointer}
    .label span{color:#7bf89c;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
    .label strong,.label small{grid-column:2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .label strong{font-size:12px}
    .label small{margin-top:-10px;color:#71877c;font:10px ui-monospace,SFMono-Regular,Menlo,monospace}
    .timeline{position:absolute;left:${labelWidth}px;right:0;top:0;height:${rowHeight}px;background-image:linear-gradient(to right,rgba(255,255,255,.05) 1px,transparent 1px);background-size:8.333% 100%}
    .bar{position:absolute;top:8px;height:30px;padding:7px 10px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#06110d;border:1px solid;border-radius:5px;font-size:11px;font-weight:760}
    .bar::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.18),transparent 46%,rgba(0,0,0,.07));pointer-events:none}
  </style>
</head>
<body>
  <header>
    <div><p>MUYANG TASK MAP / INTERACTIVE EXPORT</p><h1>${escapeHtml(root.title)}</h1></div>
    <nav class="tabs" aria-label="views">
      <button type="button" class="selected" data-view="mind">01 ${isEnglish ? "Structure" : "结构拆解"}</button>
      <button type="button" data-view="gantt">02 ${isEnglish ? "Timeline" : "时间规划"}</button>
    </nav>
  </header>
  <section class="view active" data-panel="mind"><div class="map">${renderMindMapNode(root)}</div></section>
  <section class="view" data-panel="gantt"><div class="sheet"><div class="canvas"><div class="dates">${dateLabels}</div>${rowHtml}</div></div></section>
  <script>
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("selected", item === button));
        document.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === button.dataset.view));
      });
    });
    const rows = Array.from(document.querySelectorAll(".gantt-row"));
    const canvas = document.querySelector(".canvas");
    const sheet = document.querySelector(".sheet");
    const collapsed = new Set();
    function descendantsOf(id) {
      const result = new Set();
      let changed = true;
      while (changed) {
        changed = false;
        rows.forEach((row) => {
          const parent = row.dataset.parent;
          if (parent && (parent === id || result.has(parent)) && !result.has(row.dataset.id)) {
            result.add(row.dataset.id);
            changed = true;
          }
        });
      }
      return result;
    }
    function updateRows() {
      const hidden = new Set();
      collapsed.forEach((id) => descendantsOf(id).forEach((child) => hidden.add(child)));
      let visibleIndex = 0;
      rows.forEach((row) => {
        const isHidden = hidden.has(row.dataset.id);
        row.classList.toggle("hidden", isHidden);
        if (!isHidden) {
          row.style.top = (72 + visibleIndex * ${rowHeight}) + "px";
          visibleIndex += 1;
        }
      });
      const height = 110 + visibleIndex * ${rowHeight};
      if (canvas) canvas.style.minHeight = height + "px";
      if (sheet) sheet.style.minHeight = height + "px";
      document.querySelectorAll("[data-toggle]").forEach((button) => {
        const id = button.dataset.toggle;
        const icon = button.querySelector("span");
        if (icon) icon.textContent = collapsed.has(id) ? "▸" : "▾";
      });
    }
    document.querySelectorAll("[data-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.toggle;
        if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
        updateRows();
      });
    });
    updateRows();
  </script>
</body>
</html>`;
    downloadHtml(`muyang-task-map-interactive-${new Date().toISOString().slice(0, 10)}.html`, html);
  };

  const timelinePopoverTask = timelinePopover ? tasks.find((task) => task.id === timelinePopover.taskId) : undefined;
  const timelinePopoverParent = timelinePopoverTask?.parentId ? tasks.find((task) => task.id === timelinePopoverTask.parentId) : undefined;
  const desktopProjectName = projectPath?.split(/[\\/]/).pop() ?? (isEnglish ? "Untitled plan.my" : "未命名计划.my");

  return (
    <div className={`task-map-shell${desktopMode ? " task-map-shell--desktop" : ""}`}>
      <header className="task-map-header">
        <div>
          <p>MUYANG TASK MAP</p>
          <h1>{isEnglish ? "AI Task Gantt Studio" : "AI 任务甘特图工作台"}</h1>
        </div>
        <div className="task-map-header-actions">
          {desktopMode ? (
            <>
              <span className="task-desktop-project-name" title={projectPath}>{projectDirty ? "● " : ""}{desktopProjectName}</span>
              <div className="task-desktop-file-actions">
                <span className="task-action-group-label">{isEnglish ? "Project" : "工程文件"}</span>
                <button type="button" onClick={newDesktopProject}>{isEnglish ? "New" : "新建"}</button>
                <button type="button" onClick={() => void openDesktopProject()}>{isEnglish ? "Open" : "打开"}</button>
                <button type="button" onClick={() => void saveDesktopProject()}>{isEnglish ? "Save project" : "保存工程"}</button>
                <button type="button" onClick={() => void window.taskMapDesktop?.closeWindow()}>{isEnglish ? "Exit" : "退出"}</button>
              </div>
            </>
          ) : (
            <>
              <button type="button" onClick={onOpenHome}>{isEnglish ? "Toolkit" : "工具主页"}</button>
              <a className="task-windows-download" href="https://github.com/akdddddcccc/Muyang-Tools-Frontend/releases/latest" target="_blank" rel="noreferrer">
                {isEnglish ? "Windows app" : "Windows 版"}
              </a>
            </>
          )}
          <div className="task-language-switcher" role="group" aria-label="language">
            <button className={language === "zh" ? "selected" : ""} type="button" onClick={() => onLanguageChange("zh")}>中</button>
            <button className={language === "en" ? "selected" : ""} type="button" onClick={() => onLanguageChange("en")}>EN</button>
          </div>
        </div>
      </header>

      <main className="task-map-main">
        {desktopMode ? <div className="task-desktop-status" role="status">{message}</div> : (
          <section className="task-map-hero">
            <p>01 / STRUCTURE FIRST</p>
            <h2>{isEnglish ? "One goal, infinite decomposition, then time planning." : "一个总目标，无限拆解，再进入时间规划。"}</h2>
            <span>{message}</span>
          </section>
        )}

        <div className="task-phase-toolbar">
          <nav className="task-phase-switch" aria-label={isEnglish ? "Task map phase" : "任务规划阶段"}>
            <button className={phase === "structure" ? "selected" : ""} type="button" onClick={() => setPhase("structure")}>
              <span>01</span>{isEnglish ? "Structure map" : "结构拆解"}
            </button>
            <button className={phase === "timeline" ? "selected" : ""} type="button" onClick={() => setPhase("timeline")}>
              <span>02</span>{isEnglish ? "Timeline" : "时间规划"}
            </button>
          </nav>
          <div className="task-export-actions">
            {desktopMode ? <span className="task-action-group-label">{isEnglish ? "Final output" : "成果导出"}</span> : null}
            <button type="button" onClick={exportTodoPdf}>{isEnglish ? "Export PDF" : "导出清单 PDF"}</button>
            <button type="button" onClick={exportInteractiveTaskMapHtml}>{isEnglish ? "Export HTML" : "导出交互 HTML"}</button>
          </div>
        </div>

        {phase === "structure" ? (
          <section className="task-map-structure-workbench">
            <section className="mind-map-panel task-fullscreen-target" ref={mindPanelRef}>
              <div className="task-panel-title">
                <span>{isEnglish ? "Mind Map / Logic" : "思维导图 / 逻辑关系"}</span>
                <div className="task-panel-title-actions">
                  <small className="task-shortcut-hint">{isEnglish ? "Arrows select · Enter sibling · Tab child · Delete remove" : "方向键选择 · Enter 同级 · Tab 子级 · Delete 删除"}</small>
                  <button className={`task-fullscreen-button${fullscreenPanel === "structure" ? " active" : ""}`} type="button" onClick={() => void toggleFullscreen("structure")}>
                    <span className="task-fullscreen-icon" aria-hidden="true" />
                    <span>{fullscreenPanel === "structure" ? (isEnglish ? "Exit fullscreen" : "退出全屏") : (isEnglish ? "Enter fullscreen" : "进入全屏")}</span>
                  </button>
                </div>
              </div>
              <div className="mind-map-canvas" ref={mindCanvasRef} tabIndex={0} onKeyDown={handleMindMapKeyDown}>
                <ReactFlow
                  nodes={mindFlowNodes}
                  edges={mindEdges}
                  nodeTypes={mindNodeTypes}
                  edgeTypes={mindEdgeTypes}
                  fitView
                  fitViewOptions={{ padding: 0.22 }}
                  onInit={(instance) => { mindFlowRef.current = instance; }}
                  minZoom={0.28}
                  maxZoom={1.35}
                  nodesDraggable
                  nodesConnectable={false}
                  elementsSelectable
                  selectionOnDrag
                  selectionMode={SelectionMode.Partial}
                  selectionKeyCode={null}
                  multiSelectionKeyCode={null}
                  deleteKeyCode={null}
                  panOnDrag={[1, 2]}
                  onNodesChange={handleMindNodesChange}
                  onSelectionChange={handleMindSelectionChange}
                  onNodeClick={(_, node) => selectTask(node.id)}
                  onNodeDragStop={(_, node) => keepMindNodePosition(node)}
                  onPaneClick={() => setMindContextMenu(null)}
                  onPaneContextMenu={openMindContextMenu}
                >
                  <Background color="rgba(123,248,156,.18)" gap={22} />
                  <Controls showInteractive={false} />
                </ReactFlow>
                <button className="mind-init-button" type="button" onClick={initializeRootTask}>
                  {isEnglish ? "Initialize" : "初始化"}
                </button>
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
                onSelect={selectTask}
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
          <section className="task-map-timeline-workbench">
            <section className="task-map-gantt-panel task-map-gantt-panel--wide task-fullscreen-target" ref={ganttPanelRef}>
              <div className="task-panel-title">
                <span>{isEnglish ? "Timeline / Gantt" : "时间轴 / 甘特图"}</span>
                <div className="task-map-range">
                  <button className={`task-fullscreen-button${fullscreenPanel === "timeline" ? " active" : ""}`} type="button" onClick={() => void toggleFullscreen("timeline")}>
                    <span className="task-fullscreen-icon" aria-hidden="true" />
                    <span>{fullscreenPanel === "timeline" ? (isEnglish ? "Exit fullscreen" : "退出全屏") : (isEnglish ? "Enter fullscreen" : "进入全屏")}</span>
                  </button>
                </div>
              </div>

              <div className="task-overview">
                <label>
                  <span>
                    <b>{isEnglish ? "Days per screen" : "每屏天数"}</b>
                    <em>{isEnglish ? `${viewLength} days` : `${viewLength} 天`}</em>
                  </span>
                  <div className="task-overview-control with-number">
                    <input type="range" min={minVisibleDays} max={maxVisibleDays} value={viewLength} onChange={(event) => setViewLength(Number(event.target.value))} />
                    <input type="number" min={minVisibleDays} max={maxVisibleDays} value={viewLength} onChange={(event) => setViewLength(clamp(Number(event.target.value), minVisibleDays, maxVisibleDays))} aria-label={isEnglish ? "Visible days" : "显示天数"} />
                    <button className="task-fit-all-button" type="button" onClick={() => { setViewStart(totalStart); setViewLength(maxVisibleDays); }}>{isEnglish ? "Fit all" : "显示全部"}</button>
                  </div>
                </label>
                <label className="task-root-date-field">
                  <span>
                    <b>{isEnglish ? "Project start" : "项目开始"}</b>
                    <em>{formatDay(root.startDay)}</em>
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={rootStartInput}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setRootStartInput(event.target.value)}
                    onBlur={() => commitRootDateInput("start")}
                    onKeyDown={(event) => handleRootDateKeyDown(event, "start")}
                    aria-label={isEnglish ? "Project start date" : "项目开始日期"}
                  />
                </label>
                <label className="task-root-date-field">
                  <span>
                    <b>{isEnglish ? "Project end" : "项目结束"}</b>
                    <em>{formatDay(root.endDay)}</em>
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={rootEndInput}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setRootEndInput(event.target.value)}
                    onBlur={() => commitRootDateInput("end")}
                    onKeyDown={(event) => handleRootDateKeyDown(event, "end")}
                    aria-label={isEnglish ? "Project end date" : "项目结束日期"}
                  />
                </label>
              </div>

              <div className="task-gantt-scroll" ref={chartRef} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                <div
                  className="task-gantt-grid"
                  style={{
                    width: trackViewportWidth,
                    minWidth: trackViewportWidth,
                    "--timeline-day-width": `${timelineDayWidth}px`,
                  } as CSSProperties}
                >
                  <div className="task-gantt-dates">
                    <div className="task-gantt-date-track" style={{ gridTemplateColumns: `repeat(${timelineDays.length}, ${timelineDayWidth}px)` }}>
                      {timelineDays.map((day, index) => <b key={day}>{shouldShowTimelineTick(day, index, viewLength) ? formatTimelineTick(day, viewLength) : ""}</b>)}
                    </div>
                  </div>
                  {ganttRows.map((task) => {
                    const rowBars = visibleTasks
                      .filter((rowTask) => ganttLaneHostByTaskId.get(rowTask.id) === task.id)
                      .sort((a, b) => a.startDay - b.startDay || a.endDay - b.endDay);
                    const rowSelected = task.id === selected.id || rowBars.some((rowTask) => rowTask.id === selected.id);
                    return (
                      <div className={`task-gantt-row${rowSelected ? " selected" : ""}`} key={task.id} data-task-row={task.id} style={{ minWidth: trackViewportWidth }}>
                        <div className="task-gantt-track">
                          {task.dependsOn?.map((dependencyId) => <span className="task-dependency-dot" key={dependencyId} title={dependencyId} />)}
                          {rowBars.slice(1).map((rowTask, index) => {
                            const previousTask = rowBars[index];
                            const linkStart = (previousTask.endDay + 1 - viewStart) * timelineDayWidth;
                            const linkEnd = (rowTask.startDay - viewStart) * timelineDayWidth;
                            const linkLeft = Math.min(linkStart, linkEnd);
                            const linkWidth = Math.abs(linkEnd - linkStart);
                            const linkClipped = previousTask.endDay < viewStart || rowTask.startDay > viewEnd || linkWidth < 10;
                            const color = taskBarColor(rowTask);
                            if (linkClipped) return null;
                            return (
                              <span
                                aria-hidden="true"
                                className="task-lane-link"
                                key={`${previousTask.id}-${rowTask.id}`}
                                style={{
                                  left: linkLeft,
                                  width: linkWidth,
                                  "--task-link-color": color.border,
                                  "--task-link-shadow": color.shadow,
                                } as CSSProperties}
                              />
                            );
                          })}
                          {rowBars.map((rowTask) => {
                            const left = (rowTask.startDay - viewStart) * timelineDayWidth;
                            const width = Math.max(18, (rowTask.endDay - rowTask.startDay + 1) * timelineDayWidth);
                            const clipped = rowTask.endDay < viewStart || rowTask.startDay > viewEnd;
                            if (clipped) return null;
                            return (
                              <div
                                className={`task-bar depth-${Math.min(rowTask.depth, 3)}${rowTask.id === root.id ? " root" : ""}`}
                                key={rowTask.id}
                                style={taskBarStyle(rowTask, left, width)}
                                role="button"
                                tabIndex={0}
                                title={isEnglish ? "Click to tune schedule" : "点击微调时间或 AI 初排子任务"}
                                onPointerDown={(event) => beginDrag(event, rowTask, "move")}
                                onPointerMove={moveDrag}
                                onPointerUp={endDrag}
                                onPointerCancel={endDrag}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") openTimelinePopover(event, rowTask);
                                }}
                              >
                                {rowTask.id === root.id ? null : <i className="task-bar-handle start" onPointerDown={(event) => { event.stopPropagation(); beginDrag(event, rowTask, "start"); }} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />}
                                <span>{rowTask.title}</span>
                                {rowTask.id === root.id ? null : <i className="task-bar-handle end" onPointerDown={(event) => { event.stopPropagation(); beginDrag(event, rowTask, "end"); }} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {timelinePopoverTask ? (
                <TimelineTaskPopover
                  isEnglish={isEnglish}
                  task={timelinePopoverTask}
                  parent={timelinePopoverParent}
                  root={root}
                  x={timelinePopover?.x ?? 0}
                  y={timelinePopover?.y ?? 0}
                  hasChildren={Boolean((childrenByParent.get(timelinePopoverTask.id) ?? []).length)}
                  isBusy={isBusy}
                  onUpdate={updateTask}
                  onSchedule={() => void scheduleChildren(timelinePopoverTask)}
                  onDelete={(id) => {
                    setTimelinePopover(null);
                    removeTask(id);
                  }}
                  onFocusRange={(task) => {
                    const taskDuration = Math.max(1, task.endDay - task.startDay + 1);
                    const titleReadableWidth = clamp(task.title.length * 14 + 96, trackViewportWidth * 0.5, trackViewportWidth * 0.82);
                    const titleFitWindow = Math.floor((taskDuration * trackViewportWidth) / titleReadableWidth);
                    const preferredWindow = clamp(Math.max(minVisibleDays, Math.min(taskDuration * 2, titleFitWindow)), minVisibleDays, maxVisibleDays);
                    const taskCenter = (task.startDay + task.endDay) / 2;
                    const maxStart = Math.max(totalStart, totalEnd - preferredWindow + 1);
                    setViewStart(clamp(Math.round(taskCenter - preferredWindow / 2), totalStart, maxStart));
                    setViewLength(preferredWindow);
                  }}
                  onToggleChildren={() => updateTask(timelinePopoverTask.id, { collapsed: !timelinePopoverTask.collapsed })}
                  onClose={() => setTimelinePopover(null)}
                />
              ) : null}
            </section>
          </section>
        )}
      </main>
    </div>
  );
}

function TimelineTaskPopover({ isEnglish, task, parent, root, x, y, hasChildren, isBusy, onUpdate, onSchedule, onDelete, onFocusRange, onToggleChildren, onClose }: {
  isEnglish: boolean;
  task: TaskNode;
  parent?: TaskNode;
  root: TaskNode;
  x: number;
  y: number;
  hasChildren: boolean;
  isBusy: boolean;
  onUpdate: (id: string, patch: Partial<TaskNode>) => void;
  onSchedule: () => void;
  onDelete: (id: string) => void;
  onFocusRange: (task: TaskNode) => void;
  onToggleChildren: () => void;
  onClose: () => void;
}) {
  const minStart = -36500;
  const maxEnd = Math.max(parent?.endDay ?? 0, task.endDay + 30, 120);
  const [startInput, setStartInput] = useState(formatDay(task.startDay));
  const [endInput, setEndInput] = useState(formatDay(task.endDay));

  useEffect(() => {
    setStartInput(formatDay(task.startDay));
  }, [task.id, task.startDay]);

  useEffect(() => {
    setEndInput(formatDay(task.endDay));
  }, [task.id, task.endDay]);

  const changeStart = (value: number, options?: { expandEnd?: boolean }) => {
    const rawStart = Math.max(minStart, Math.round(value));
    const nextStart = options?.expandEnd ? rawStart : clamp(rawStart, minStart, task.endDay - minDuration);
    const nextEnd = options?.expandEnd && nextStart > task.endDay - minDuration
      ? nextStart + minDuration
      : task.endDay;
    onUpdate(task.id, { startDay: nextStart, endDay: nextEnd });
    return nextStart;
  };
  const changeEnd = (value: number, options?: { pullStart?: boolean }) => {
    const rawEnd = Math.max(minStart + minDuration, Math.round(value));
    const nextEnd = options?.pullStart ? rawEnd : clamp(rawEnd, task.startDay + minDuration, maxEnd);
    const nextStart = options?.pullStart && nextEnd < task.startDay + minDuration
      ? Math.max(minStart, nextEnd - minDuration)
      : task.startDay;
    onUpdate(task.id, { startDay: nextStart, endDay: nextEnd });
    return nextEnd;
  };
  const commitDateInput = (kind: "start" | "end") => {
    const rawValue = kind === "start" ? startInput : endInput;
    const parsedDay = parseTimelineDateInput(rawValue);
    if (parsedDay === null) {
      if (kind === "start") setStartInput(formatDay(task.startDay));
      else setEndInput(formatDay(task.endDay));
      return;
    }
    if (kind === "start") {
      const nextStart = changeStart(parsedDay, { expandEnd: true });
      setStartInput(formatDay(nextStart));
    } else {
      const nextEnd = changeEnd(parsedDay, { pullStart: true });
      setEndInput(formatDay(nextEnd));
    }
  };
  const handleDateInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, kind: "start" | "end") => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commitDateInput(kind);
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (kind === "start") setStartInput(formatDay(task.startDay));
      else setEndInput(formatDay(task.endDay));
      event.currentTarget.blur();
    }
  };

  return (
    <aside className="timeline-task-popover" style={{ left: x, top: y }}>
      <div className="timeline-task-popover-head">
        <span>{isEnglish ? "Task timing" : "任务时间设置"}</span>
        <button type="button" onClick={onClose} aria-label={isEnglish ? "Close" : "关闭"}>×</button>
      </div>
      <strong>{task.title}</strong>
      <small>{formatDay(task.startDay)} - {formatDay(task.endDay)}</small>
      <div className="timeline-task-fields">
        <label>
          {isEnglish ? "Start" : "开始"}
          <input
            type="text"
            inputMode="decimal"
            value={startInput}
            placeholder={formatDay(task.startDay)}
            title={isEnglish ? "Try 2025.12.1, 7.1 or 07/01" : "可输入 2025.12.1、7.1 或 07/01"}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setStartInput(event.target.value)}
            onBlur={() => commitDateInput("start")}
            onKeyDown={(event) => handleDateInputKeyDown(event, "start")}
          />
        </label>
        <label>
          {isEnglish ? "End" : "结束"}
          <input
            type="text"
            inputMode="decimal"
            value={endInput}
            placeholder={formatDay(task.endDay)}
            title={isEnglish ? "Try 2025.12.1, 7.1 or 07/01" : "可输入 2025.12.1、7.1 或 07/01"}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setEndInput(event.target.value)}
            onBlur={() => commitDateInput("end")}
            onKeyDown={(event) => handleDateInputKeyDown(event, "end")}
          />
        </label>
        <label>
          {isEnglish ? "Lane" : "轨道"}
          <input type="number" min={0} max={12} value={task.lane} onChange={(event) => onUpdate(task.id, { lane: Math.max(0, Math.round(Number(event.target.value))) })} />
        </label>
      </div>
      <div className="timeline-task-popover-actions">
        <button type="button" onClick={onSchedule} disabled={isBusy || !hasChildren}>{isEnglish ? "AI schedule children" : "AI 时间初排子任务"}</button>
        <button type="button" onClick={onToggleChildren} disabled={!hasChildren}>{task.collapsed ? (isEnglish ? "Expand children" : "展开子级") : (isEnglish ? "Collapse children" : "收起子级")}</button>
        <button type="button" onClick={() => onFocusRange(task)}>{isEnglish ? "Focus range" : "聚焦范围"}</button>
        <button type="button" onClick={() => onDelete(task.id)} disabled={task.id === root.id}>{isEnglish ? "Delete" : "删除"}</button>
      </div>
      <p>{isEnglish ? "Drag the bar for rough timing, then fine tune here." : "可先拖动任务条粗排，再在这里精细化时间。"}</p>
    </aside>
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
