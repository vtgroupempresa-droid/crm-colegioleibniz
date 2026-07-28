import { NextResponse } from 'next/server';
import { listClosers } from '@/actions/leads-queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  const closers = await listClosers();
  return NextResponse.json({ closers });
}
