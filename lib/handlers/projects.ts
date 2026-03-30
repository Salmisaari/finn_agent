// lib/handlers/projects.ts
// Finn — Sales project/case management
// Each project is a thesis-driven initiative with market intel,
// supplier positions, actions, and proposals.
// KV-backed, Slack-native interface.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let kv: any | null = null;

async function getKV() {
  if (kv) return kv;
  if (!process.env.KV_REST_API_URL) return null;
  try {
    const { kv: vercelKv } = await import('@vercel/kv');
    kv = vercelKv;
    return kv;
  } catch {
    return null;
  }
}

// ========================================
// DATA MODEL
// ========================================

export interface ProjectIntel {
  date: string;
  source: string;
  signal: string;
}

export type SupplierStatus = 'monitoring' | 'contacted' | 'negotiating' | 'locked' | 'blocked' | 'lost';

export interface SupplierPosition {
  supplier: string;
  prefix?: string;
  org_id?: number;
  status: SupplierStatus;
  price_offered?: string;
  terms?: string;
  contact_person?: string;
  notes: string;
  last_updated: string;
}

export interface ProjectAction {
  id: string;
  action: string;
  owner: string;
  due?: string;
  done: boolean;
  created_at: string;
}

export interface FinnProject {
  id: string;
  name: string;
  category: string;              // e.g. "disposables", "workwear", "safety"
  status: 'active' | 'paused' | 'closed';

  // THESIS — why this matters, updated as intel comes in
  thesis: string;

  // MARKET INTEL — timestamped signals
  intel: ProjectIntel[];

  // SUPPLIER POSITIONS — per-supplier tracking
  positions: SupplierPosition[];

  // PLAYBOOK — what to do next
  actions: ProjectAction[];

  // PROPOSALS — ready-to-send pitch angles
  proposals: string[];

  created_at: string;
  updated_at: string;
}

// ========================================
// CRUD
// ========================================

function kvKey(id: string): string {
  return `finn:project:${id}`;
}

const INDEX_KEY = 'finn:projects:index';

export async function getProject(id: string): Promise<FinnProject | null> {
  const store = await getKV();
  if (!store) return null;
  return (await store.get(kvKey(id))) as FinnProject | null;
}

export async function saveProject(project: FinnProject): Promise<void> {
  const store = await getKV();
  if (!store) throw new Error('KV not configured');

  project.updated_at = new Date().toISOString();
  await store.set(kvKey(project.id), project);

  // Update index
  const index = ((await store.get(INDEX_KEY)) as string[]) || [];
  if (!index.includes(project.id)) {
    index.push(project.id);
    await store.set(INDEX_KEY, index);
  }
}

export async function listProjects(): Promise<FinnProject[]> {
  const store = await getKV();
  if (!store) return [];

  const index = ((await store.get(INDEX_KEY)) as string[]) || [];
  const projects = await Promise.all(
    index.map((id) => getProject(id))
  );
  return projects.filter(Boolean) as FinnProject[];
}

// ========================================
// PROJECT OPERATIONS
// ========================================

export async function createProject(opts: {
  id: string;
  name: string;
  category: string;
  thesis: string;
}): Promise<FinnProject> {
  const project: FinnProject = {
    id: opts.id,
    name: opts.name,
    category: opts.category,
    status: 'active',
    thesis: opts.thesis,
    intel: [],
    positions: [],
    actions: [],
    proposals: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await saveProject(project);
  return project;
}

export async function addIntel(
  projectId: string,
  source: string,
  signal: string
): Promise<FinnProject | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  project.intel.push({
    date: new Date().toISOString().split('T')[0],
    source,
    signal,
  });

  await saveProject(project);
  return project;
}

export async function setSupplierPosition(
  projectId: string,
  position: SupplierPosition
): Promise<FinnProject | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  const existing = project.positions.findIndex(
    (p) => p.supplier.toLowerCase() === position.supplier.toLowerCase()
  );

  position.last_updated = new Date().toISOString().split('T')[0];

  if (existing >= 0) {
    project.positions[existing] = position;
  } else {
    project.positions.push(position);
  }

  await saveProject(project);
  return project;
}

export async function addAction(
  projectId: string,
  action: string,
  owner: string,
  due?: string
): Promise<FinnProject | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  project.actions.push({
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    action,
    owner,
    due,
    done: false,
    created_at: new Date().toISOString().split('T')[0],
  });

  await saveProject(project);
  return project;
}

export async function completeAction(
  projectId: string,
  actionId: string
): Promise<FinnProject | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  const action = project.actions.find((a) => a.id === actionId);
  if (action) action.done = true;

  await saveProject(project);
  return project;
}

export async function updateThesis(
  projectId: string,
  thesis: string
): Promise<FinnProject | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  project.thesis = thesis;
  await saveProject(project);
  return project;
}

export async function addProposal(
  projectId: string,
  proposal: string
): Promise<FinnProject | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  project.proposals.push(proposal);
  await saveProject(project);
  return project;
}

// ========================================
// DASHBOARD FORMATTING (Slack-native)
// ========================================

const STATUS_ICONS: Record<SupplierStatus, string> = {
  monitoring: '~',
  contacted: '>',
  negotiating: '*',
  locked: '+',
  blocked: '!',
  lost: 'x',
};

export function formatProjectDashboard(project: FinnProject): string {
  const lines: string[] = [];

  // Header
  lines.push(`${project.name.toUpperCase()}`);
  lines.push(`${'─'.repeat(40)}`);
  lines.push(`Status: ${project.status}  |  Category: ${project.category}`);
  lines.push(`Updated: ${project.updated_at.split('T')[0]}`);
  lines.push('');

  // Thesis
  lines.push('THESIS');
  lines.push(project.thesis);
  lines.push('');

  // Supplier positions
  if (project.positions.length > 0) {
    lines.push('SUPPLIER POSITIONS');
    lines.push(`${'─'.repeat(40)}`);

    // Group by status
    const byStatus: Record<string, SupplierPosition[]> = {};
    for (const p of project.positions) {
      if (!byStatus[p.status]) byStatus[p.status] = [];
      byStatus[p.status].push(p);
    }

    for (const [status, positions] of Object.entries(byStatus)) {
      lines.push(`  ${status.toUpperCase()} (${positions.length})`);
      for (const p of positions) {
        const icon = STATUS_ICONS[p.status as SupplierStatus] || '?';
        const price = p.price_offered ? ` | ${p.price_offered}` : '';
        lines.push(`  ${icon} ${p.supplier}${price}`);
        if (p.notes) lines.push(`    ${p.notes}`);
      }
    }
    lines.push('');
  }

  // Latest intel (last 5)
  if (project.intel.length > 0) {
    lines.push('LATEST INTEL');
    lines.push(`${'─'.repeat(40)}`);
    const recent = project.intel.slice(-5);
    for (const i of recent) {
      lines.push(`  ${i.date} [${i.source}]`);
      lines.push(`  ${i.signal}`);
    }
    lines.push('');
  }

  // Open actions
  const openActions = project.actions.filter((a) => !a.done);
  if (openActions.length > 0) {
    lines.push('OPEN ACTIONS');
    lines.push(`${'─'.repeat(40)}`);
    for (const a of openActions) {
      const due = a.due ? ` (due ${a.due})` : '';
      lines.push(`  - ${a.action} [${a.owner}]${due}`);
    }
    lines.push('');
  }

  // Proposals
  if (project.proposals.length > 0) {
    lines.push('PROPOSALS');
    lines.push(`${'─'.repeat(40)}`);
    for (let i = 0; i < project.proposals.length; i++) {
      lines.push(`  ${i + 1}. ${project.proposals[i]}`);
    }
  }

  return lines.join('\n');
}
