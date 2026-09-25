import { Router, type Request } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { escapeRegex, parse, parsePatch } from '../../utils/validate';
import { AppError, conflict, notFound } from '../../utils/errors';
import { authenticateTenant, requireAnyPermission, requirePermission } from '../../middleware/auth';
import { audit } from '../audit/auditService';
import { oid } from '../common/helpers';
import { meta } from '../../models/meta';
import { publicBranding } from '../branding/brandingService';
import { DHATerminologyService } from '../../integrations/hie/services';
import { buildTemplate, importUpload, readImport, sendXlsx, summarize, yesNo, type ImportColumn, type RowResult } from '../imports/excel';
import { DEFAULT_DIAGNOSES } from './defaults';

/**
 * The facility's diagnosis / disease catalog. It starts with common admission diagnoses (names only),
 * and administrators add, edit or import their own with optional ICD codes. It feeds the diagnosis
 * suggestions on the admission and consultation screens.
 */
const router = Router();
router.use(authenticateTenant);
const READ = requireAnyPermission('inpatient.admit', 'inpatient.view', 'consultation.create', 'consultation.view', 'admin.settings');
const MANAGE = requirePermission('admin.settings');

export const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const CODE_RE = /^[A-Za-z0-9.\/&-]{2,20}$/;
const SYSTEMS = ['ICD-11', 'ICD-10', 'local'] as const;

/** Adds the starter list once per facility. */
export async function seedDiagnoses(req: Request) {
  const { FacilitySetting, Diagnosis } = req.tenant!.models;
  if (await FacilitySetting.exists({ key: 'diagnosisCatalogSeeded' })) return;
  await FacilitySetting.updateOne({ key: 'diagnosisCatalogSeeded' }, { $set: { value: true } }, { upsert: true });
  for (const d of DEFAULT_DIAGNOSES) {
    await Diagnosis.updateOne({ nameKey: nameKey(d.name) }, { $setOnInsert: { name: d.name, nameKey: nameKey(d.name), category: d.category, synonyms: d.synonyms ?? [], admission: true, notifiable: !!d.notifiable, system: 'ICD-11', source: 'default' } }, { upsert: true });
  }
}

const itemSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().max(20).regex(CODE_RE, 'can only contain letters, numbers and . / & -').optional().or(z.literal('')),
  system: z.enum(SYSTEMS).default('ICD-11'),
  category: z.string().trim().max(60).optional(),
  synonyms: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  admission: z.boolean().default(false),
  notifiable: z.boolean().default(false),
  active: z.boolean().default(true),
});

router.get(
  '/',
  READ,
  h(async (req, res) => {
    await seedDiagnoses(req);
    const q = String(req.query.q ?? '').trim();
    const filter: Record<string, unknown> = req.query.all === 'true' ? {} : { active: true };
    if (req.query.admission === 'true') filter.admission = true;
    if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: re }, { code: re }, { synonyms: re }, { category: re }];
    }
    res.json({ success: true, data: await req.tenant!.models.Diagnosis.find(filter).sort({ category: 1, name: 1 }).limit(1000).lean() });
  }),
);

/**
 * Suggestions while typing a diagnosis: the facility catalog (admission diagnoses first when admitting),
 * this facility's recent admission diagnoses, and the national DHA terminology when it is connected.
 */
router.get(
  '/suggest',
  READ,
  h(async (req, res) => {
    await seedDiagnoses(req);
    const q = String(req.query.q ?? '').trim();
    const forAdmission = req.query.context === 'admission';
    const m = req.tenant!.models;
    const re = q ? new RegExp(escapeRegex(q), 'i') : null;
    const catalog = await m.Diagnosis.find({ active: true, ...(re ? { $or: [{ name: re }, { code: re }, { synonyms: re }] } : forAdmission ? { admission: true } : {}) })
      .sort({ name: 1 }).limit(re ? 30 : 60).lean();
    const out: Array<{ display: string; code?: string; system?: string; category?: string; source: 'catalog' | 'recent' | 'dha' }> = [];
    const seen = new Set<string>();
    const push = (d: (typeof out)[number]) => {
      const k = nameKey(d.display);
      if (seen.has(k)) return;
      seen.add(k);
      out.push(d);
    };
    const sorted = forAdmission ? [...catalog].sort((a, b) => Number(b.admission) - Number(a.admission)) : catalog;
    for (const d of sorted) push({ display: d.name, code: d.code || undefined, system: d.code ? d.system : undefined, category: d.category ?? undefined, source: 'catalog' });
    if (forAdmission) {
      const recent = await m.Admission.find(re ? { admissionDiagnosis: re } : {}).sort({ admittedAt: -1 }).limit(200).select('admissionDiagnosis').lean();
      const counts = new Map<string, { display: string; n: number }>();
      for (const r of recent) {
        const d = (r.admissionDiagnosis ?? '').trim();
        if (!d) continue;
        const c = counts.get(nameKey(d)) ?? { display: d, n: 0 };
        c.n += 1;
        counts.set(nameKey(d), c);
      }
      [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 10).forEach((c) => push({ display: c.display, source: 'recent' }));
    }
    if (q.length >= 3) {
      try {
        const rows = (await DHATerminologyService.search({ tenantId: req.tenant!.id, userId: req.user!.id, requestId: req.requestId }, { q })) as unknown;
        const list = Array.isArray(rows) ? rows : [];
        for (const r of list.slice(0, 15) as Array<{ display?: string; code?: string; system?: string }>) if (r.display) push({ display: r.display, code: r.code, system: r.system, source: 'dha' });
      } catch {
        /* national terminology not connected: catalog and history only */
      }
    }
    res.json({ success: true, data: out.slice(0, 40) });
  }),
);

router.post(
  '/',
  MANAGE,
  h(async (req, res) => {
    await seedDiagnoses(req);
    const body = parse(itemSchema, req.body);
    const { Diagnosis } = req.tenant!.models;
    if (await Diagnosis.exists({ nameKey: nameKey(body.name) })) throw conflict(`"${body.name}" is already in the list`, undefined, 'DUPLICATE');
    const d = await Diagnosis.create({ ...body, code: body.code ? body.code.toUpperCase() : undefined, nameKey: nameKey(body.name), source: 'custom', createdBy: req.user!.id });
    await audit(req, { action: 'diagnosis.create', resource: 'diagnosis', resourceId: String(d._id), newValue: body });
    res.status(201).json({ success: true, data: d });
  }),
);

router.patch(
  '/:id',
  MANAGE,
  h(async (req, res) => {
    const body = parsePatch(itemSchema.partial(), req.body);
    const { Diagnosis } = req.tenant!.models;
    const d = await Diagnosis.findById(oid(req.params.id as string, 'Diagnosis'));
    if (!d) throw notFound('Diagnosis not found');
    if (body.name && nameKey(body.name) !== d.nameKey && (await Diagnosis.exists({ nameKey: nameKey(body.name) }))) throw conflict(`"${body.name}" is already in the list`, undefined, 'DUPLICATE');
    const before = d.toObject();
    d.set({ ...body, ...(body.name ? { nameKey: nameKey(body.name) } : {}), ...(body.code !== undefined ? { code: body.code ? body.code.toUpperCase() : undefined } : {}) });
    await d.save();
    await audit(req, { action: 'diagnosis.update', resource: 'diagnosis', resourceId: String(d._id), oldValue: before, newValue: d.toObject() });
    res.json({ success: true, data: d });
  }),
);

/* ------------------------------------------------------------ Excel import */
const COLUMNS: ImportColumn[] = [
  { key: 'name', header: 'Diagnosis / disease', required: true, width: 36, note: 'The name shown to staff. An existing name updates that entry.' },
  { key: 'code', header: 'Code', width: 12, note: 'Optional ICD-11, ICD-10 or local code, e.g. BA00. Only enter codes you have checked.' },
  { key: 'system', header: 'Code system', width: 12, list: SYSTEMS, note: 'Defaults to ICD-11.' },
  { key: 'category', header: 'Category', width: 20, note: 'e.g. Respiratory, Obstetric, Injuries.' },
  { key: 'synonyms', header: 'Other names', width: 28, note: 'Abbreviations or other names, separated by commas, e.g. CVA, cerebrovascular accident.' },
  { key: 'admission', header: 'Offer when admitting', width: 18, kind: 'yesno', note: 'Yes to show it first on the admission form.' },
  { key: 'notifiable', header: 'Notifiable disease', width: 16, kind: 'yesno' },
  { key: 'active', header: 'Active', width: 10, kind: 'yesno', note: 'No hides it from suggestions.' },
];

router.get(
  '/import-template',
  MANAGE,
  h(async (req, res) => {
    const tenant = await meta().Tenant.findById(req.tenant!.id).select('name slug branding').lean();
    const brand = publicBranding(tenant!);
    sendXlsx(res, 'diagnoses-template.xlsx', await buildTemplate({
      facility: brand.name,
      color: brand.primaryColor,
      title: 'Diagnoses and diseases',
      sheetName: 'Diagnoses',
      columns: COLUMNS,
      examples: [
        { name: 'Severe malaria', category: 'Infections', synonyms: 'complicated malaria', admission: 'Yes', notifiable: 'No', active: 'Yes' },
        { name: 'Essential hypertension', system: 'ICD-11', category: 'Cardiovascular', synonyms: 'HTN', admission: 'No', active: 'Yes' },
        { name: 'Cholera', category: 'Infections', admission: 'Yes', notifiable: 'Yes', active: 'Yes' },
      ],
      instructions: [
        'Fill in the "Diagnoses" sheet from row 4, one diagnosis or disease per row. Only the name is required.',
        'If the name already exists (ignoring upper/lower case), that entry is updated; otherwise a new one is added.',
        'Codes are optional. Only enter codes you have checked against the official ICD browser: they appear on records and claims.',
        'Upload the file on Admin → Diagnoses → Import from Excel. You will see a preview before anything is saved.',
      ],
    }));
  }),
);

router.post(
  '/import',
  MANAGE,
  importUpload,
  h(async (req, res) => {
    const commit = String(req.body?.commit ?? req.query.commit ?? '') === 'true';
    await seedDiagnoses(req);
    const rows = await readImport(req.file, COLUMNS);
    const { Diagnosis } = req.tenant!.models;
    const existing = new Map((await Diagnosis.find({ nameKey: { $in: rows.map((r) => nameKey(r.values.name ?? '')) } }).lean()).map((d) => [d.nameKey, d]));
    const seen = new Map<string, number>();
    const results: Array<RowResult & { set?: Record<string, unknown> }> = [];
    for (const { row, values } of rows) {
      const errors: string[] = [];
      const name = (values.name ?? '').trim();
      const key = nameKey(name);
      if (name.length < 2 || name.length > 160) errors.push('Diagnosis / disease must be 2 to 160 characters');
      else if (seen.has(key)) errors.push(`Also on row ${seen.get(key)}`);
      if (name) seen.set(key, row);
      const code = (values.code ?? '').trim().toUpperCase();
      if (code && !CODE_RE.test(code)) errors.push('Code can only contain letters, numbers and . / & - (2 to 20 characters)');
      const system = (values.system ?? '').trim() || (code ? 'ICD-11' : '');
      if (system && !(SYSTEMS as readonly string[]).includes(system)) errors.push(`Code system must be one of: ${SYSTEMS.join(', ')}`);
      const flags: Record<string, boolean | null> = {};
      for (const k of ['admission', 'notifiable', 'active'] as const) {
        const v = yesNo(values[k] ?? '');
        if (v === undefined) errors.push(`${COLUMNS.find((c) => c.key === k)!.header} must be Yes or No`);
        flags[k] = v ?? null;
      }
      const synonyms = (values.synonyms ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (synonyms.length > 20 || synonyms.some((s) => s.length > 60)) errors.push('Up to 20 other names of at most 60 characters');
      if ((values.category ?? '').length > 60) errors.push('Category must be at most 60 characters');
      if (errors.length) {
        results.push({ row, key: name || `(row ${row})`, name, action: 'error', errors });
        continue;
      }
      const set: Record<string, unknown> = { name, nameKey: key };
      if (code) set.code = code;
      if (system) set.system = system;
      if (values.category) set.category = values.category.trim();
      if (synonyms.length) set.synonyms = synonyms;
      for (const [k, v] of Object.entries(flags)) if (v !== null) set[k] = v;
      const cur = existing.get(key);
      // Names match ignoring case and spacing; an update keeps the existing spelling.
      if (cur) set.name = cur.name;
      if (!cur) {
        results.push({ row, key: name, name, action: 'create', errors: [], set });
        continue;
      }
      const changes = Object.entries(set).filter(([k, v]) => !['nameKey'].includes(k) && JSON.stringify(v) !== JSON.stringify((cur as Record<string, unknown>)[k])).map(([k, v]) => `${k} → ${Array.isArray(v) ? v.join(', ') : String(v)}`);
      results.push({ row, key: name, name, action: changes.length ? 'update' : 'unchanged', errors: [], set, changes });
    }
    const summary = summarize(results);
    const publicRows = results.map(({ set: _s, ...r }) => r);
    if (commit) {
      if (summary.errors) throw new AppError(422, 'IMPORT_HAS_ERRORS', `Nothing was imported: ${summary.errors} row(s) have problems. Fix them and upload again.`, { summary, rows: publicRows });
      for (const r of results) {
        if (r.action === 'create') await Diagnosis.create({ admission: false, active: true, system: 'ICD-11', ...r.set, source: 'import', createdBy: req.user!.id });
        else if (r.action === 'update') await Diagnosis.updateOne({ nameKey: String(r.set!.nameKey) }, { $set: r.set });
      }
      await audit(req, { action: 'diagnosis.import', resource: 'diagnosis', resourceId: 'bulk', newValue: { file: req.file?.originalname, ...summary } });
    }
    res.json({ success: true, data: { committed: commit, summary, rows: publicRows } });
  }),
);

export default router;
