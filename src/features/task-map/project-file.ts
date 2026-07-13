export const taskMapProjectKind = "muyang-task-map-project";
export const taskMapProjectVersion = 1;

export type TaskMapPhase = "structure" | "timeline";

export interface TaskMapTask {
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

export interface TaskMapProjectDocument {
  kind: typeof taskMapProjectKind;
  schemaVersion: typeof taskMapProjectVersion;
  createdAt: string;
  updatedAt: string;
  tasks: TaskMapTask[];
  nodePositions: Record<string, { x: number; y: number }>;
  view: {
    phase: TaskMapPhase;
    selectedId: string;
    viewStart: number;
    viewLength: number;
  };
}

export type TaskMapProjectState = Pick<TaskMapProjectDocument, "tasks" | "nodePositions" | "view">;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTask(value: unknown): value is TaskMapTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<TaskMapTask>;
  return typeof task.id === "string"
    && typeof task.title === "string"
    && isFiniteNumber(task.startDay)
    && isFiniteNumber(task.endDay)
    && isFiniteNumber(task.lane);
}

export function createTaskMapProjectDocument(state: TaskMapProjectState, createdAt = new Date().toISOString()): TaskMapProjectDocument {
  return {
    kind: taskMapProjectKind,
    schemaVersion: taskMapProjectVersion,
    createdAt,
    updatedAt: new Date().toISOString(),
    tasks: state.tasks,
    nodePositions: state.nodePositions,
    view: state.view,
  };
}

export function projectStateSnapshot(state: TaskMapProjectState) {
  return JSON.stringify(state);
}

export function parseTaskMapProjectDocument(content: string): TaskMapProjectDocument {
  const value = JSON.parse(content) as Partial<TaskMapProjectDocument>;
  if (value.kind !== taskMapProjectKind || value.schemaVersion !== taskMapProjectVersion) {
    throw new Error("unsupported_project_format");
  }
  if (!Array.isArray(value.tasks) || !value.tasks.length || !value.tasks.every(isTask)) {
    throw new Error("invalid_project_tasks");
  }
  const rootCount = value.tasks.filter((task) => !task.parentId).length;
  if (rootCount !== 1) throw new Error("invalid_project_root");
  const positions = value.nodePositions && typeof value.nodePositions === "object" ? value.nodePositions : {};
  const view = value.view && typeof value.view === "object" ? value.view : undefined;
  const root = value.tasks.find((task) => !task.parentId)!;
  return {
    kind: taskMapProjectKind,
    schemaVersion: taskMapProjectVersion,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    tasks: value.tasks,
    nodePositions: Object.fromEntries(Object.entries(positions).filter((entry): entry is [string, { x: number; y: number }] => {
      const position = entry[1] as { x?: unknown; y?: unknown };
      return isFiniteNumber(position?.x) && isFiniteNumber(position?.y);
    })),
    view: {
      phase: view?.phase === "timeline" ? "timeline" : "structure",
      selectedId: typeof view?.selectedId === "string" ? view.selectedId : root.id,
      viewStart: isFiniteNumber(view?.viewStart) ? view.viewStart : root.startDay,
      viewLength: isFiniteNumber(view?.viewLength) ? view.viewLength : Math.max(2, root.endDay - root.startDay + 1),
    },
  };
}
