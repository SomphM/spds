import { readFile } from 'node:fs/promises';
import { database,closeDatabase } from '../src/db.js';
// Preserve the supplied schema; run Users before the Transactions foreign key.
try {
  const text=await readFile(new URL('../schema.txt',import.meta.url),'utf8');
  const users=text.lastIndexOf('USE [SPDS]');
  const ordered=text.slice(users)+'\n'+text.slice(0,users);
  const pool=await database();
  const existing=await pool.request().query("SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo') AND name IN ('Users','Transactions','Alerts')");
  if (existing.recordset.length) throw new Error('Tables already exist. Initialization stopped; no tables changed.');
  // Use the configured database; do not redirect to the hard-coded source name.
  const batches=ordered.replace(/USE \[SPDS\]/g,'').split(/^GO\s*$/mi).filter(s=>s.trim());
  const tx=pool.transaction(); await tx.begin();
  try { for (const batch of batches) await tx.request().batch(batch); await tx.commit(); }
  catch(error) { await tx.rollback(); throw error; }
  console.log('Created Users, Alerts, and Transactions. No demo records were imported.');
} catch(error) { console.error('Initialization failed:',error.message);process.exitCode=1; }
finally { await closeDatabase(); }
