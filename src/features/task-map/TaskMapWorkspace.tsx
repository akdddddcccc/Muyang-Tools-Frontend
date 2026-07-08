import { useMemo, useRef, useState } from "react";
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

export function TaskMapWorkspace({ language, onLanguageChange, onOpenHome, onOpenLiveSticker }: { language: Language; onLanguageChange: (language: Language) => void; onOpenHome: () => void; onOpenLiveSticker: () => void }) {
  const isEnglish = language === "en";
  const [tasks, setTasks] = useState<TaskNode[]>(loadInitialTasks);
  const [selectedId, setSelectedId] = useState("goal");
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

  const visibleTasks = useMemo(() => {
    const rows: Array<TaskNode & { depth: number }> = [];
    const walk = (task: TaskNode, depth: number) => {
      rows.push({ ...task, depth });
      if (task.collapsed) return;
      (childrenByParent.get(task.id) ?? []).forEach((child) => walk(child, depth + 1));
    };
    if (root) walk(root, 0);
    return rows;
  }, [childrenByParent, root]);

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
  };

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

  const createAiBreakdown = async () => {
    if (!selected) return;
    if ((childrenByParent.get(selected.id) ?? []).length) {
      setMessage(isEnglish ? "AI breakdown only works on leaf nodes." : "AI 拆解只对没有子任务的节点生效。");
      return;
    }
    setIsBusy(true);
    try {
      const ancestors: TaskNode[] = [];
      let cursor = selected;
      while (cursor.parentId) {
        const parent = tasks.find((task) => task.id === cursor.parentId);
        if (!parent) break;
        ancestors.unshift(parent);
        cursor = parent;
      }
      const siblings = tasks.filter((task) => task.parentId === selected.parentId && task.id !== selected.id);
      const result = await createTaskBreakdown({
        task: taskInput(selected),
        ancestors: ancestors.map(taskInput),
        siblings: siblings.map(taskInput),
        locale: language,
      });
      mergeBreakdown(result.items.length ? result.items : fallbackBreakdown(selected), result.provider);
    } catch (error) {
      mergeBreakdown(fallbackBreakdown(selected), "local-fallback");
      setMessage(isEnglish ? "Core unavailable, local breakdown inserted." : "Core 暂不可用，已插入本地拆分建议。");
    } finally {
      setIsBusy(false);
    }
  };

  const mergeBreakdown = (items: TaskMapBreakdownItem[], provider: string) => {
    const safeItems = items.slice(0, 6).filter((item) => item.title?.trim());
    const span = Math.max(minDuration * safeItems.length, selected.endDay - selected.startDay + 1);
    const step = Math.max(minDuration + 1, Math.floor(span / Math.max(1, safeItems.length)));
    const children = safeItems.map((item, index): TaskNode => {
      const startDay = clamp(selected.startDay + index * step, selected.startDay, selected.endDay - minDuration);
      return {
        id: createId("ai"),
        parentId: selected.id,
        title: item.title.trim(),
        note: item.note?.trim(),
        startDay,
        endDay: clamp(index === safeItems.length - 1 ? selected.endDay : startDay + step + 2, startDay + minDuration, selected.endDay),
        lane: index,
        dependsOn: index > 0 ? [] : undefined,
      };
    });
    persist([...tasks, ...children]);
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
            <div className="task-editor">
              <label>
                {isEnglish ? "Title" : "标题"}
                <input value={selected.title} onChange={(event) => updateTask(selected.id, { title: event.target.value })} />
              </label>
              <label>
                {isEnglish ? "Note" : "备注"}
                <textarea value={selected.note ?? ""} onChange={(event) => updateTask(selected.id, { note: event.target.value })} />
              </label>
              <div className="task-editor-actions">
                <button type="button" onClick={createAiBreakdown} disabled={isBusy || Boolean((childrenByParent.get(selected.id) ?? []).length)}>{isEnglish ? "AI split" : "AI 拆解"}</button>
                <button type="button" onClick={scheduleChildren} disabled={isBusy}>{isEnglish ? "AI schedule" : "AI 时间初排"}</button>
                <button type="button" onClick={() => removeTask(selected.id)} disabled={selected.id === root.id}>{isEnglish ? "Delete" : "删除"}</button>
              </div>
            </div>
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
      </main>
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
