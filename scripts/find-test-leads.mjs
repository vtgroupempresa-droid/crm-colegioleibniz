import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env = {};
for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

console.log('URL do Supabase em uso:', env.NEXT_PUBLIC_SUPABASE_URL);

console.log('\n=== 10 leads mais recentes ===');
const { data: recent } = await admin
  .from('leads')
  .select('id,name,email,phone,pipeline,stage,created_at')
  .order('created_at', { ascending: false })
  .limit(10);
for (const l of recent ?? []) {
  console.log(`- ${l.created_at} | ${l.name} | ${l.email ?? '—'} | ${l.phone ?? '—'} | ${l.pipeline}/${l.stage}`);
}

console.log('\n=== Busca por tokens (nome) ===');
for (const p of ['%couto%', '%jafari%', '%enric%', '%test%']) {
  const { data } = await admin.from('leads').select('id,name,email,phone,stage').ilike('name', p);
  console.log(`${p}: ${data?.length ?? 0} resultado(s)`);
  for (const l of data ?? []) console.log(`    ${l.id} | ${l.name} | ${l.email ?? '—'} | ${l.phone ?? '—'} | ${l.stage}`);
}
