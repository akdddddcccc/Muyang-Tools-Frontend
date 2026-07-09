import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Background, Controls, Handle, Position, ReactFlow, SelectionMode, applyNodeChanges, type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
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
  startY: number;
  originalStart: number;
  originalEnd: number;
  originalLane: number;
  activated: boolean;
  changed: boolean;
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

type TimelinePopoverState = {
  taskId: string;
  x: number;
  y: number;
} | null;

const storageKey = "muyang-task-map-project-v1";
const maxDayWidth = 34;
const minDayWidth = 4;
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
    return {
      ...task,
      dependsOn: previous ? [...externalDependencies, previous.id] : externalDependencies.length ? externalDependencies : undefined,
    };
  });
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
  const chartRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragHoldTimerRef = useRef<number | null>(null);
  const latestTasksRef = useRef<TaskNode[]>(tasks);

  const root = tasks.find((task) => !task.parentId) ?? tasks[0];
  const selected = tasks.find((task) => task.id === selectedId) ?? root;
  latestTasksRef.current = tasks;
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

  const totalEnd = Math.max(...tasks.map((task) => task.endDay), 120);
  const totalDays = totalEnd + 1;
  const maxVisibleDays = Math.max(24, totalDays);
  const trackViewportWidth = Math.max(360, chartWidth - 260);
  const timelineDayWidth = clamp(trackViewportWidth / Math.max(1, viewLength), minDayWidth, maxDayWidth);
  const timelineDays = Array.from({ length: viewLength }, (_, index) => viewStart + index);
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
    const maxStart = Math.max(0, totalDays - viewLength);
    if (viewStart > maxStart) setViewStart(maxStart);
    if (viewLength > maxVisibleDays) setViewLength(maxVisibleDays);
  }, [maxVisibleDays, totalDays, viewLength, viewStart]);

  const persist = (nextTasks: TaskNode[]) => {
    const normalizedTasks = includeAncestorRanges(nextTasks);
    setTasks(normalizedTasks);
    window.localStorage.setItem(storageKey, JSON.stringify(normalizedTasks));
  };

  const selectTask = useCallback((id: string) => {
    setSelectedId(id);
    setSelectedNodeIds([id]);
  }, []);

  const updateTask = (id: string, patch: Partial<TaskNode>) => {
    persist(tasks.map((task) => task.id === id ? { ...task, ...patch } : task));
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
    persist([...tasks, next]);
    if (options?.select ?? true) selectTask(next.id);
    setNodePositions((positions) => ({
      ...positions,
      [next.id]: positions[next.id] ?? {
        x: (taskDepth(parent, tasks) + 1) * 310,
        y: (visibleTasks.findIndex((task) => task.id === parent.id) + Math.max(1, children.length + 1)) * 96,
      },
    }));
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
        children: children.map((child) => ({ ...taskInput(child), startDay: child.startDay, endDay: child.endDay, lane: child.lane })),
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
    persist(tasks.map((task) => {
      const item = byId.get(task.id);
      if (!item) return task;
      return {
        ...task,
        startDay: clamp(Math.round(item.startDay), parent.startDay, parent.endDay - minDuration),
        endDay: clamp(Math.round(item.endDay), Math.round(item.startDay) + minDuration, parent.endDay),
        lane: Math.max(0, Math.round(item.lane)),
        dependsOn: item.dependsOn?.filter((id) => id !== task.id),
        note: item.note || task.note,
      };
    }));
    setMessage(isEnglish ? `Schedule updated via ${provider}.` : `已通过 ${provider} 初排时间。`);
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
    const minStart = 0;
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
      const normalizedTasks = includeAncestorRanges(nextTasks);
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
            onAddChild: addChildById,
            onAiBreakdown: createAiBreakdownById,
            onToggle: toggleTaskById,
          },
          draggable: true,
        };
      });
    });
  }, [visibleTasks, nodePositions, childrenByParent, selectedNodeIds, isBusy, root.id, selectTask, addChildById, createAiBreakdownById, toggleTaskById]);

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

  const handleMindSelectionChange = useCallback(({ nodes }: { nodes: Node<MindNodeData>[] }) => {
    if (!nodes.length) return;
    const ids = nodes.map((node) => node.id);
    setSelectedNodeIds(ids);
    setSelectedId(ids[ids.length - 1] ?? ids[0]);
  }, []);

  const downloadHtml = (filename: string, html: string) => {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
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
    body{margin:0;padding:32px;color:#101418;background:#fff;font-family:Inter,"PingFang SC","Microsoft YaHei",Arial,sans-serif}
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
  <script>
    window.addEventListener("load", () => setTimeout(() => window.print(), 180));
  </script>
</body>
</html>`;
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      downloadHtml(`muyang-task-map-todo-${new Date().toISOString().slice(0, 10)}.html`, html);
      setMessage(isEnglish ? "Popup blocked. Downloaded a printable todo HTML instead." : "浏览器拦截了打印窗口，已改为下载可打印清单 HTML。");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const renderMindMapNode = (task: TaskNode, depth = 0): string => {
    const children = childrenByParent.get(task.id) ?? [];
    const color = taskBarColor({ ...task, depth });
    return `
      <details class="mind-node depth-${Math.min(depth, 4)}${children.length ? "" : " leaf"}" ${depth < 2 ? "open" : ""}>
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
    body{margin:0;min-height:100vh;padding:30px;background:#0b1015;color:#edf4ef;font-family:Inter,"PingFang SC","Microsoft YaHei",Arial,sans-serif}
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
    .mind-children::before{content:"";position:absolute;left:-22px;top:28px;bottom:28px;width:1px;background:rgba(215,255,88,.42);box-shadow:0 0 12px rgba(215,255,88,.22)}
    .mind-children>.mind-node::before{content:"";position:absolute;left:-22px;top:28px;width:22px;height:1px;background:rgba(215,255,88,.58);box-shadow:0 0 12px rgba(215,255,88,.22)}
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
    const dateLabels = Array.from({ length: totalDays }, (_, day) => day)
      .filter((day) => day % 7 === 0)
      .map((day) => `<span style="left:${labelWidth + day * exportDayWidth}px">${formatDay(day)}</span>`)
      .join("");
    const rowHtml = rows.map((task, index) => {
      const color = taskBarColor(task);
      const hasChildren = Boolean((childrenByParent.get(task.id) ?? []).length);
      const barLeft = labelWidth + task.startDay * exportDayWidth;
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
    body{margin:0;min-height:100vh;padding:30px;background:#0b1015;color:#edf4ef;font-family:Inter,"PingFang SC","Microsoft YaHei",Arial,sans-serif}
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

  const timelinePopoverTask = timelinePopover ? tasks.find((task) => task.id === timelinePopover.taskId) : undefined;
  const timelinePopoverParent = timelinePopoverTask?.parentId ? tasks.find((task) => task.id === timelinePopoverTask.parentId) : undefined;

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
                <small className="task-shortcut-hint">{isEnglish ? "Arrows select · Enter sibling · Tab child · Delete remove" : "方向键选择 · Enter 同级 · Tab 子级 · Delete 删除"}</small>
                <div className="task-map-range">
                  <button type="button" onClick={resetProject}>{isEnglish ? "Reset" : "恢复示例"}</button>
                </div>
              </div>
              <div className="mind-map-canvas" tabIndex={0} onKeyDown={handleMindMapKeyDown}>
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
            <section className="task-map-gantt-panel task-map-gantt-panel--wide">
              <div className="task-panel-title">
                <span>{isEnglish ? "Timeline / Gantt" : "时间轴 / 甘特图"}</span>
                <div className="task-map-range">
                  <button type="button" onClick={exportTodoPdf}>{isEnglish ? "Todo PDF" : "清单 PDF"}</button>
                  <button type="button" onClick={exportMindMapHtml}>{isEnglish ? "Mind HTML" : "思维 HTML"}</button>
                  <button type="button" onClick={exportGanttHtml}>{isEnglish ? "Gantt HTML" : "甘特 HTML"}</button>
                  <button type="button" onClick={() => { setViewStart(0); setViewLength(maxVisibleDays); }}>{isEnglish ? "Fit all" : "显示全部"}</button>
                  <button type="button" onClick={resetProject}>{isEnglish ? "Reset" : "恢复示例"}</button>
                </div>
              </div>

              <div className="task-overview">
                <label>
                  <span>
                    <b>{isEnglish ? "Start day" : "视图起点"}</b>
                    <em>{formatDay(viewStart)}</em>
                  </span>
                  <div className="task-overview-control">
                    <input type="range" min={0} max={Math.max(0, totalDays - viewLength)} value={viewStart} onChange={(event) => setViewStart(Number(event.target.value))} />
                  </div>
                </label>
                <label>
                  <span>
                    <b>{isEnglish ? "Visible days" : "显示天数"}</b>
                    <em>{isEnglish ? `${viewLength} days` : `${viewLength} 天`}</em>
                  </span>
                  <div className="task-overview-control with-number">
                    <input type="range" min={24} max={maxVisibleDays} value={viewLength} onChange={(event) => setViewLength(Number(event.target.value))} />
                    <input type="number" min={24} max={maxVisibleDays} value={viewLength} onChange={(event) => setViewLength(clamp(Number(event.target.value), 24, maxVisibleDays))} aria-label={isEnglish ? "Visible days" : "显示天数"} />
                  </div>
                </label>
              </div>

              <div className="task-gantt-scroll" ref={chartRef} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                <div className="task-gantt-grid" style={{ width: timelineDays.length * timelineDayWidth + 260, minWidth: timelineDays.length * timelineDayWidth + 260 }}>
                  <div className="task-gantt-dates">
                    <span />
                    <div className="task-gantt-date-track" style={{ gridTemplateColumns: `repeat(${timelineDays.length}, ${timelineDayWidth}px)` }}>
                      {timelineDays.map((day) => <b key={day}>{day % 7 === 0 ? formatDay(day) : ""}</b>)}
                    </div>
                  </div>
                  {visibleTasks.map((task) => {
                    const rowBars = visibleTasks
                      .filter((rowTask) => ganttLaneHostByTaskId.get(rowTask.id) === task.id)
                      .sort((a, b) => a.startDay - b.startDay || a.endDay - b.endDay);
                    const rowSelected = task.id === selected.id || rowBars.some((rowTask) => rowTask.id === selected.id);
                    return (
                      <div className={`task-gantt-row${rowSelected ? " selected" : ""}`} key={task.id} data-task-row={task.id} style={{ minWidth: timelineDays.length * timelineDayWidth + 260 }}>
                        <button className="task-gantt-label" type="button" style={{ paddingLeft: 12 + task.depth * 16 }} onClick={() => selectTask(task.id)}>
                          <span>{task.title}</span>
                          <small>{formatDay(task.startDay)} - {formatDay(task.endDay)}</small>
                        </button>
                        <div className="task-gantt-track">
                          {task.dependsOn?.map((dependencyId) => <span className="task-dependency-dot" key={dependencyId} title={dependencyId} />)}
                          {rowBars.slice(1).map((rowTask, index) => {
                            const previousTask = rowBars[index];
                            const linkStart = 260 + (previousTask.endDay + 1 - viewStart) * timelineDayWidth;
                            const linkEnd = 260 + (rowTask.startDay - viewStart) * timelineDayWidth;
                            const linkLeft = Math.min(linkStart, linkEnd);
                            const linkWidth = Math.abs(linkEnd - linkStart);
                            const linkClipped = previousTask.endDay < viewStart || rowTask.startDay > viewStart + viewLength || linkWidth < 10;
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
                            const left = 260 + (rowTask.startDay - viewStart) * timelineDayWidth;
                            const width = Math.max(18, (rowTask.endDay - rowTask.startDay + 1) * timelineDayWidth);
                            const clipped = rowTask.endDay < viewStart || rowTask.startDay > viewStart + viewLength;
                            if (clipped) return null;
                            return (
                              <div
                                className={`task-bar depth-${Math.min(rowTask.depth, 3)}`}
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
                                <i className="task-bar-handle start" onPointerDown={(event) => { event.stopPropagation(); beginDrag(event, rowTask, "start"); }} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
                                <span>{rowTask.title}</span>
                                <i className="task-bar-handle end" onPointerDown={(event) => { event.stopPropagation(); beginDrag(event, rowTask, "end"); }} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
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
                    setViewStart(Math.max(0, task.startDay - 4));
                    setViewLength(Math.max(28, task.endDay - task.startDay + 10));
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
  const minStart = 0;
  const maxEnd = Math.max(parent?.endDay ?? 0, task.endDay + 30, 120);
  const changeStart = (value: number) => {
    onUpdate(task.id, { startDay: clamp(Math.round(value), minStart, task.endDay - minDuration) });
  };
  const changeEnd = (value: number) => {
    onUpdate(task.id, { endDay: clamp(Math.round(value), task.startDay + minDuration, maxEnd) });
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
          <input type="number" min={minStart} max={task.endDay - minDuration} value={task.startDay} onChange={(event) => changeStart(Number(event.target.value))} />
        </label>
        <label>
          {isEnglish ? "End" : "结束"}
          <input type="number" min={task.startDay + minDuration} max={maxEnd} value={task.endDay} onChange={(event) => changeEnd(Number(event.target.value))} />
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
