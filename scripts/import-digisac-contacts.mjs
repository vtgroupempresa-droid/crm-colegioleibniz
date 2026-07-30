/**
 * Importação idempotente dos contatos exportados pelo Digisac.
 *
 * Uso (as credenciais vêm apenas de um arquivo temporário de ambiente):
 *   node --env-file=/caminho/.env scripts/import-digisac-contacts.mjs --commit
 *
 * Sem --commit, apenas valida e apresenta a prévia. Os contatos históricos
 * entram em uma etapa inativa para não disparar automações ou poluir o funil.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const CONTACTS_DIR = process.env.DIGISAC_CONTACTS_DIR ?? '/Users/vt/Downloads';
const HISTORY_STAGE = 'historico_digisac';
const HISTORY_TAG = 'Migração Digisac';
const commit = process.argv.includes('--commit');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** CSV do Digisac usa ; e pode conter quebras de linha dentro de campos com aspas. */
function parseCsv(raw) {
  const firstLine = raw.slice(0, raw.search(/\r?\n/u));
  const delimiter = (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length
    ? ';'
    : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === '"') {
      if (quoted && raw[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && raw[i + 1] === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function clean(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Identidade canônica BR: DDI 55 e nono dígito de celular normalizados. */
function canonicalPhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  const national =
    (digits.length === 12 || digits.length === 13) && digits.startsWith('55')
      ? digits.slice(2)
      : digits;
  if (national.length === 10 && /^[6-9]/.test(national.slice(2))) {
    return `55${national.slice(0, 2)}9${national.slice(2)}`;
  }
  if (national.length === 10 || national.length === 11) return `55${national}`;
  return digits || null;
}

function parseDigisacDate(value) {
  const match = String(value ?? '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}T12:00:00.000Z`;
}

function sourceForFile(fileName) {
  if (fileName.includes('Instagram')) return 'instagram';
  if (fileName.includes('Facebook')) return 'outro';
  return 'outro';
}

function sourceLabel(fileName) {
  return fileName
    .replace(/^Contatos_/, '')
    .replace(/_30_07_2026_\d{2}_\d{2}_\d{2}\.csv$/, '')
    .replaceAll('_', ' ');
}

function tagsFrom(rawTags, department, attendant, label) {
  const tags = new Set([HISTORY_TAG, `Origem Digisac: ${label}`]);
  if (department) tags.add(`Departamento Digisac: ${department}`);
  if (attendant) tags.add(`Atendente Digisac: ${attendant}`);
  for (const tag of String(rawTags ?? '').split(/[;,|]/)) {
    const value = clean(tag);
    if (value) tags.add(value);
  }
  return [...tags].slice(0, 40);
}

function mergeRecord(current, incoming) {
  const score = (value) => (value ? value.replace(/\D/g, '').length + value.length / 100 : 0);
  return {
    ...current,
    name: score(incoming.name) > score(current.name) ? incoming.name : current.name,
    email: current.email ?? incoming.email,
    createdAt: incoming.createdAt < current.createdAt ? incoming.createdAt : current.createdAt,
    source: current.source === 'instagram' ? current.source : incoming.source,
    tags: [...new Set([...current.tags, ...incoming.tags])].slice(0, 40),
  };
}

function readContacts() {
  const files = readdirSync(CONTACTS_DIR)
    .filter((file) => /^Contatos_.*_30_07_2026_.*\.csv$/u.test(file))
    .sort();
  const byPhone = new Map();
  let rowsRead = 0;
  let invalidRows = 0;

  for (const file of files) {
    const rows = parseCsv(readFileSync(join(CONTACTS_DIR, file), 'utf8'));
    const header = rows.shift() ?? [];
    const index = (name) => header.indexOf(name);
    const nameIndex = index('Nome'); // a 1ª coluna é o nome do contato (a última é duplicada pelo Digisac)
    const ddiIndex = index('DDI');
    const numberIndex = index('Número');
    const emailIndex = index('E-mail');
    const attendantIndex = index('Atendente Padrão');
    const departmentIndex = index('Departamento Padrão');
    const tagsIndex = index('Tags');
    const createdIndex = index('Criado em');
    const label = sourceLabel(file);

    for (const row of rows) {
      rowsRead += 1;
      const phone = canonicalPhone(`${row[ddiIndex] ?? ''}${row[numberIndex] ?? ''}`);
      const name = clean(row[nameIndex]);
      const createdAt = parseDigisacDate(row[createdIndex]);
      if (!phone || !name || !createdAt) {
        invalidRows += 1;
        continue;
      }
      const record = {
        phone,
        name,
        email: clean(row[emailIndex])?.toLowerCase() ?? null,
        source: sourceForFile(file),
        createdAt,
        tags: tagsFrom(row[tagsIndex], clean(row[departmentIndex]), clean(row[attendantIndex]), label),
      };
      const previous = byPhone.get(phone);
      byPhone.set(phone, previous ? mergeRecord(previous, record) : record);
    }
  }
  return { files: files.length, rowsRead, invalidRows, contacts: [...byPhone.values()] };
}

async function ensureHistoryStage() {
  const { data: existing, error: lookupError } = await admin
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline', 'comercial')
    .eq('slug', HISTORY_STAGE)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return;
  const { error } = await admin.from('pipeline_stages').insert({
    pipeline: 'comercial',
    slug: HISTORY_STAGE,
    name: 'Histórico Digisac',
    position: 999,
    color: '#94a3b8',
    is_active: false,
    is_entry: false,
    is_terminal: false,
    required_fields: [],
    stage_win_probability: 0,
  });
  if (error) throw error;
}

async function loadExistingByIdentity() {
  const { data, error } = await admin
    .from('leads')
    .select('id, phone, phone_normalized')
    .not('phone_normalized', 'is', null);
  if (error) throw error;
  return new Map((data ?? []).map((lead) => [canonicalPhone(lead.phone_normalized ?? lead.phone), lead.id]));
}

async function insertInBatches(rows) {
  const size = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size);
    const { error } = await admin.from('leads').insert(batch);
    if (error) throw new Error(`Lote ${i / size + 1}: ${error.message}`);
    inserted += batch.length;
  }
  return inserted;
}

const parsed = readContacts();
const existing = await loadExistingByIdentity();
const alreadyInCrm = parsed.contacts.filter((contact) => existing.has(contact.phone));
const toInsert = parsed.contacts
  .filter((contact) => !existing.has(contact.phone))
  .map((contact) => ({
    name: contact.name,
    email: contact.email,
    phone: `+${contact.phone}`,
    phone_normalized: contact.phone,
    source: contact.source,
    tags: contact.tags,
    pipeline: 'comercial',
    stage: HISTORY_STAGE,
    last_entered_at: contact.createdAt,
    created_at: contact.createdAt,
    is_archived: false,
    is_demo: false,
  }));

const report = {
  mode: commit ? 'commit' : 'dry-run',
  files: parsed.files,
  sourceRows: parsed.rowsRead,
  invalidRows: parsed.invalidRows,
  uniqueContacts: parsed.contacts.length,
  matchedExistingPipelineContacts: alreadyInCrm.length,
  toInsert: toInsert.length,
};

if (!commit) {
  console.log(JSON.stringify(report));
  process.exit(0);
}

await ensureHistoryStage();
report.inserted = await insertInBatches(toInsert);
console.log(JSON.stringify(report));
process.exit(0);
